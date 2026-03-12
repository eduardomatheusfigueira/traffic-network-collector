import React, { useState, useEffect, useRef } from 'react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Progress } from './components/ui/progress';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Download, Map as MapIcon, Activity, Loader2, AlertCircle, Settings, Key, X, Eye, EyeOff, CheckCircle2, Navigation, Route as RouteIcon, Car, Footprints, Bike, Truck, Bus } from 'lucide-react';
import Papa from 'papaparse';
import axios from 'axios';

// Corrige o problema do ícone do Leaflet no React
import L from 'leaflet';
// @ts-ignore
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

interface Node {
  lat: number;
  lon: number;
}

interface Segment {
  id: string;
  u: number;
  v: number;
  osmid: number;
  name: string;
  highway: string;
  start: Node;
  end: Node;
  geometry: Node[];
  length: number;
  speed_kph: number;
  travel_time: number;
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  trafficStatus?: string;
  error?: string;
  timestamp?: string;
}

function MapUpdater({ segments }: { segments: Segment[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (segments.length > 0) {
      const bounds = L.latLngBounds(segments.map(s => [s.start.lat, s.start.lon]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [segments, map]);

  return null;
}

export default function App() {
  const [city, setCity] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loadingNetwork, setLoadingNetwork] = useState(false);
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // Estados para data e hora personalizadas
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');

  // Estados para busca por rota ou cidade
  const [searchMode, setSearchMode] = useState<'city' | 'route'>('city');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [travelMode, setTravelMode] = useState('car');
  const [splitIntersections, setSplitIntersections] = useState(false);

  // Estados para o painel de configurações
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tomtomApiKeys, setTomtomApiKeys] = useState<{ id: string; name: string; value: string }[]>([]);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [isKeyApplied, setIsKeyApplied] = useState(false);

  // Carrega as chaves da API do localStorage ao inicializar
  useEffect(() => {
    const savedKeys = localStorage.getItem('tomtom_api_keys');
    if (savedKeys) {
      try {
        setTomtomApiKeys(JSON.parse(savedKeys));
        setIsKeyApplied(true);
      } catch (e) {
        console.error('Failed to parse saved API keys');
      }
    }
  }, []);

  // Salva as chaves da API no localStorage
  const handleApplyKeys = () => {
    // Filtra chaves vazias antes de salvar
    const validKeys = tomtomApiKeys.filter(k => k.value.trim() !== '');
    setTomtomApiKeys(validKeys);
    localStorage.setItem('tomtom_api_keys', JSON.stringify(validKeys));
    setIsKeyApplied(true);
    setTimeout(() => setIsKeyApplied(false), 3000); // Reseta o estado de sucesso após 3 segundos
  };

  const addApiKey = () => {
    setTomtomApiKeys([...tomtomApiKeys, { id: Date.now().toString(), name: '', value: '' }]);
    setIsKeyApplied(false);
  };

  const removeApiKey = (id: string) => {
    setTomtomApiKeys(tomtomApiKeys.filter(k => k.id !== id));
    setIsKeyApplied(false);
  };

  const updateApiKey = (id: string, field: 'name' | 'value', value: string) => {
    setTomtomApiKeys(tomtomApiKeys.map(k => k.id === id ? { ...k, [field]: value } : k));
    setIsKeyApplied(false);
  };

  /**
   * Busca a malha viária (ou por cidade via Overpass, ou por Rota via TomTom+Overpass).
   * Popula o estado `segments` que desenha as linhas no mapa.
   */
  const fetchNetwork = async () => {
    if (searchMode === 'city' && !city.trim()) {
      setError('Por favor, insira o nome de uma cidade.');
      return;
    }
    if (searchMode === 'route' && (!origin.trim() || !destination.trim())) {
      setError('Por favor, insira ponto de partida e chegada.');
      return;
    }

    setLoadingNetwork(true);
    setError(null);
    setSegments([]);

    const apiUrl = import.meta.env.VITE_API_URL || '';

    try {
      let response;
      if (searchMode === 'city') {
        response = await axios.post(`${apiUrl}/api/network`, { city });
      } else {
        response = await axios.post(`${apiUrl}/api/network/route`, { 
          origin, 
          destination, 
          travelMode, 
          splitIntersections,
          apiKeys: tomtomApiKeys.filter(k => k.value.trim() !== '') // Envia o array completo de chaves válidas configuradas
        });
      }
      setSegments(response.data.segments);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao buscar malha viária.');
    } finally {
      setLoadingNetwork(false);
    }
  };

  /**
   * Coleta dados de trânsito em tempo real para os segmentos carregados.
   * Agrupa as requisições em lotes (batches) de 50 no cliente para 
   * criar uma barra de progresso visual fluida e evitar sobrecarga na API.
   */
  const fetchTraffic = async () => {
    if (segments.length === 0) return;

    setLoadingTraffic(true);
    setError(null);
    setProgress(0);

    try {
      // Processa em lotes (batches) no cliente para atualizar a barra de progresso fluidamente
      const batchSize = 50;
      let allResults: Segment[] = [];
      
      let departAt = undefined;
      if (useCustomTime && customDate && customTime) {
        // Formato esperado pela API TomTom: YYYY-MM-DDTHH:mm:ss
        departAt = `${customDate}T${customTime}:00`;
      }
      
      for (let i = 0; i < segments.length; i += batchSize) {
        const batch = segments.slice(i, i + batchSize);
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const response = await axios.post(`${apiUrl}/api/traffic`, { 
          segments: batch, 
          departAt,
          apiKeys: tomtomApiKeys.filter(k => k.value.trim() !== '') 
        });
        
        allResults = [...allResults, ...response.data.results];
        
        // Atualiza o estado dos segmentos progressivamente para refletir na interface
        setSegments(prev => {
          const newSegments = [...prev];
          response.data.results.forEach((resSeg: Segment) => {
            const index = newSegments.findIndex(s => s.id === resSeg.id);
            if (index !== -1) {
              newSegments[index] = resSeg;
            }
          });
          return newSegments;
        });

        setProgress(Math.round(((i + batch.length) / segments.length) * 100));
      }
      
      setProgress(100);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao buscar dados de trânsito. Verifique sua chave de API da TomTom.');
    } finally {
      setLoadingTraffic(false);
    }
  };

  /**
   * Processa os segmentos analisados e gera um arquivo CSV contendo
   * coordenadas geográficas, comprimento, velocidades, IDs e tempo de viagem.
   */
  const downloadCSV = () => {
    if (segments.length === 0) return;

    const csvData = segments.map(s => ({
      u: s.u || '',
      v: s.v || '',
      osmid: s.osmid || '',
      name: s.name,
      highway: s.highway,
      length: typeof s.length === 'number' ? s.length.toFixed(2) : s.length,
      speed_kph: s.speed_kph || '',
      travel_time: typeof s.travel_time === 'number' ? s.travel_time.toFixed(2) : (s.travel_time || ''),
      startLat: s.start.lat,
      startLon: s.start.lon,
      endLat: s.end.lat,
      endLon: s.end.lon,
      realtime_distanceMeters: s.distanceMeters || '',
      realtime_duration: s.duration || '',
      realtime_staticDuration: s.staticDuration || '',
      trafficStatus: s.trafficStatus || 'PENDING',
      timestamp: s.timestamp || '',
      error: s.error || ''
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const fileName = searchMode === 'city' ? city : `${origin}_para_${destination}`;
    link.setAttribute('href', url);
    link.setAttribute('download', `transito_${fileName.replace(/\s+/g, '_')}_${new Date().toISOString()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Retorna a cor do trecho no mapa baseado na proporção entre
   * tempo com trânsito (durationSecs) e tempo via livre (staticSecs).
   * Verde (Livre), Amarelo (Moderado) ou Vermelho (Lento).
   */
  const getSegmentColor = (segment: Segment) => {
    if (!segment.duration || !segment.staticDuration) return '#3b82f6'; // azul-500 padrão (sem dados)
    
    const durationSecs = parseInt(segment.duration.replace('s', ''));
    const staticSecs = parseInt(segment.staticDuration.replace('s', ''));
    
    if (isNaN(durationSecs) || isNaN(staticSecs)) return '#3b82f6';
    
    const ratio = durationSecs / staticSecs;
    
    if (ratio <= 1.1) return '#22c55e'; // verde-500 (rápido/livre)
    if (ratio <= 1.5) return '#eab308'; // amarelo-500 (moderado)
    return '#ef4444'; // vermelho-500 (lento/congestionado)
  };

  const segmentsWithTraffic = segments.filter(s => s.trafficStatus === 'SUCCESS').length;

  return (
    <div className="bg-gradient-to-br from-background-light to-slate-100 text-text-light min-h-screen flex flex-col font-display selection:bg-primary selection:text-white">
      {/* CABEÇALHO */}
      <header className="glass bg-white/80 border-b border-border-light py-3 px-4 lg:px-8 flex flex-col lg:flex-row lg:items-center justify-between gap-3 lg:gap-4 sticky top-0 z-[1100] shadow-sm backdrop-blur-md mb-6">
        <div className="flex items-center gap-4 lg:gap-6 justify-between w-full lg:w-auto">
          <img alt="Itaipu Parquetec Logo" className="h-10 w-auto object-contain" src="data:image/png;base64,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X1TP5+OPPy7UhTBjxgwVhy66dOkCqWfAEsGV6pnoiOSdoaPjiPI8db8zdn3Rtf387rNcKmTTSrumpVylj5upEoDF1oV9bAI008ariQAM/No05TwCKjyE1157reqZ2w8hO0337dtXxo0bJ7xAAI+fnDSeQV6UfD18wAN5aNAPO+wwadu2rSoWebjG/75kyRLV41QJBf4wkK/LGmajQ3qTfu4ogANAodFhGrGtX8rGFTN69Gg1DRkgpxEkvhIDjb5fpwHX04IFCwQd6OrHs8a9xwrQ0fzsZz/TJUUaz/t51llnaXlidQFOfveMe7tp0ybxA4YgEzcKfWe8hFfgwnRAr8Skx3FTopYRt9Kp08cn3mLJV28FNG36CuMzre49ueyD//SkAZV8cpOOS4gX3+9lyvei0LOFly7QwAIeuvTG+MZfepw02n49w0ZK799PPvnEOyETC6hmDnn/aVDpfeoI6Uk6e406OuIpExD3a4igS2oAZHWy0WHwcz2582EFAMrueK6xJPw6BtBEEe677z4tGywugpbAlWBbwK5odYl149cpi/KdoUAFLuVY7U7hRYUqS5at214UC3dmgOWrT51f8cDirBcg01BXKxc8daUzOtZzgMWvF6kThgZQ55bK96L49WwBFhpYXble8VgBH330kVdS3rig6xr8GNEb16VjEWJ96dJ18TREuoZVl6fc8XSEdbrga55BOwzOegDKuJ2ccfb5I488Yp+W7KgDeVymWC1hCwaMdB2zJ598Ussu6ndGgYsqLdNYq2Ol/NSk5IW310cmLfuGNTdgsZUDwDy94i8Ff9TM5lPIkZejEGCxy3KvjrfjOdJL5egOfrOHyBMWWGz+AAxAaV/HedT11mlEglqEXvLSsHrFJzXuuef2fUvJLePpp58ujBkUEq644go3O3U9efJkdSzVj9+ziuuukLqQh6nAXjLrrF8/OQp9ZxS4bN3+uZcciY9buPLTSGRctXWtHPX7EZL0wfuiKlvdSSa/8VhRLArJfOONNxaSLZsHIGCMJRvhONE1uAyOOsiyp7i1CunZZhlkTgDKIDOOMqSR/TONWccM140uLWh8vsHtoHzioGMAW1cOi3UZMygk6BpdZiiWwv1u1wEL3D53H5lUUEhdyONnheBidZele2egK/SdUeAS91YqCFxsYDry1MWbimWj8j/51iwp5dYuqpAy/2C9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" />
          <h1 className="text-xl font-bold border-l pl-6 border-slate-300 tracking-tight text-slate-800">
            Coletor de Trânsito
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon" 
            className="rounded-full hover:bg-slate-100"
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            title="Configurações de API"
          >
            <Settings className={`w-5 h-5 text-slate-600 transition-transform ${isSettingsOpen ? 'rotate-90' : ''}`} />
          </Button>
        </div>
      </header>

      {/* PAINEL DE CONFIGURAÇÕES (Retrátil) */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isSettingsOpen ? 'max-h-[600px] opacity-100 mb-6' : 'max-h-0 opacity-0'}`}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 w-full">
          <Card className="border-primary/20 bg-blue-50/30 backdrop-blur-sm">
            <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                <CardTitle className="text-base font-semibold">Configurações de API</CardTitle>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsSettingsOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </CardHeader>
            <CardContent className="pb-4 pt-0 px-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Key className="w-4 h-4 text-primary" />
                    <span>Chaves API TomTom</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    Obtenha sua chave gratuita no <a href="https://developer.tomtom.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">Portal do Desenvolvedor TomTom</a>. 
                    Crie uma conta e registre um "App" para obter sua API Key.
                  </p>
                </div>
                
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {tomtomApiKeys.map((keyObj) => (
                    <div key={keyObj.id} className="flex gap-2 items-start">
                      <div className="flex-1 space-y-2">
                        <Input 
                          placeholder="Nome (ex: Chave Principal)" 
                          value={keyObj.name}
                          onChange={(e) => updateApiKey(keyObj.id, 'name', e.target.value)}
                          className="bg-white"
                        />
                        <div className="relative">
                          <Input 
                            type={showApiKey[keyObj.id] ? "text" : "password"}
                            placeholder="Cole sua chave aqui..." 
                            value={keyObj.value}
                            onChange={(e) => updateApiKey(keyObj.id, 'value', e.target.value)}
                            className="bg-white pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(prev => ({ ...prev, [keyObj.id]: !prev[keyObj.id] }))}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {showApiKey[keyObj.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeApiKey(keyObj.id)} className="mt-6 text-red-500 hover:text-red-700 hover:bg-red-50">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {tomtomApiKeys.length === 0 && (
                    <p className="text-sm text-slate-500 italic">Nenhuma chave configurada. Adicione uma para usar os serviços de rota e trânsito.</p>
                  )}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-200/60 mt-2">
                  <Button variant="outline" size="sm" onClick={addApiKey} className="text-primary border-primary/20 hover:bg-primary/5">
                    + Adicionar Chave
                  </Button>
                   <div className="flex gap-2">
                     <Button 
                       variant={isKeyApplied ? "outline" : "default"} 
                       size="sm" 
                       onClick={handleApplyKeys}
                       className={isKeyApplied ? "border-green-500 text-green-600 hover:bg-green-50" : ""}
                     >
                       {isKeyApplied ? (
                         <><CheckCircle2 className="w-4 h-4 mr-2" /> Aplicado</>
                       ) : (
                         'Aplicar Chaves'
                       )}
                     </Button>
                     <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(false)}>
                       Fechar
                     </Button>
                   </div>
                </div>
                <p className="text-[10px] text-slate-500">
                  Suas chaves são salvas apenas no seu navegador (localStorage). O sistema tentará usar a próxima chave caso a atual exceda o limite.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <main className="flex-1 p-4 md:p-8 flex flex-col gap-6 md:gap-8 relative max-w-7xl mx-auto w-full">
        {error && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-lg flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Controles Laterais */}
          <div className="space-y-6">
            <Card className="glass border-white/40 shadow-xl overflow-hidden">
              <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-primary/10 p-2 rounded-lg">
                    <MapIcon className="w-5 h-5 text-primary" />
                  </div>
                  <CardTitle className="text-xl">1. Obter Malha Viária</CardTitle>
                </div>
                <CardDescription>Defina a área ou trajeto para coleta.</CardDescription>
                
                <div className="flex p-1 bg-slate-100 rounded-lg mt-4">
                  <button 
                    onClick={() => setSearchMode('city')}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${searchMode === 'city' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Por Cidade
                  </button>
                  <button 
                    onClick={() => setSearchMode('route')}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${searchMode === 'route' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    Por Rota
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-5">
                {searchMode === 'city' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 ml-1">Nome da Cidade</label>
                    <Input
                      placeholder="Ex: São Paulo, SP"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && fetchNetwork()}
                      className="bg-slate-50 border-slate-200 focus:bg-white transition-all rounded-lg h-11"
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700 ml-1 flex items-center gap-2">
                        <Navigation className="w-3.5 h-3.5" /> Partida
                      </label>
                      <Input
                        placeholder="Endereço de origem"
                        value={origin}
                        onChange={(e) => setOrigin(e.target.value)}
                        className="bg-slate-50 border-slate-200 focus:bg-white transition-all rounded-lg"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700 ml-1 flex items-center gap-2">
                        <RouteIcon className="w-3.5 h-3.5" /> Chegada
                      </label>
                      <Input
                        placeholder="Endereço de destino"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        className="bg-slate-50 border-slate-200 focus:bg-white transition-all rounded-lg"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700 ml-1">Modo de Viagem</label>
                      <select 
                        value={travelMode}
                        onChange={(e) => setTravelMode(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-sans"
                      >
                        <option value="car">🚗 Carro</option>
                        <option value="truck">🚛 Caminhão</option>
                        <option value="bus">🚌 Ônibus</option>
                        <option value="motorcycle">🏍️ Motocicleta</option>
                        <option value="bicycle">🚲 Bicicleta</option>
                        <option value="pedestrian">🚶 Pedestre</option>
                      </select>
                    </div>

                    <div className="flex items-center space-x-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <input 
                        type="checkbox" 
                        id="split" 
                        checked={splitIntersections} 
                        onChange={(e) => setSplitIntersections(e.target.checked)}
                        className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary/20"
                      />
                      <label htmlFor="split" className="text-xs font-medium text-slate-600 cursor-pointer">
                        Dividir rota nas intersecções (OSM)
                      </label>
                    </div>
                  </div>
                )}
                
                <Button 
                  onClick={fetchNetwork} 
                  disabled={loadingNetwork}
                  className="w-full bg-primary hover:bg-primary-dark shadow-md hover:shadow-lg transition-all rounded-lg h-12 text-base font-semibold group"
                >
                  {loadingNetwork ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Buscando...</>
                  ) : (
                    <MapIcon className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                  )}
                  {searchMode === 'city' ? 'Buscar Malha Viária' : 'Buscar Rota'}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  2. Coletar Trânsito
                </CardTitle>
                <CardDescription>
                  Consulta a API da TomTom para obter o tempo de deslocamento atual de cada trecho.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm text-zinc-600 mb-2">
                  <span>Trechos encontrados:</span>
                  <span className="font-semibold text-zinc-900">{segments.length}</span>
                </div>
                
                <div className="space-y-3 pt-2 border-t border-zinc-100">
                  <div className="flex items-center space-x-2">
                    <input 
                      type="checkbox" 
                      id="useCustomTime" 
                      className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                      checked={useCustomTime}
                      onChange={(e) => setUseCustomTime(e.target.checked)}
                    />
                    <label htmlFor="useCustomTime" className="text-sm font-medium text-zinc-700">
                      Usar data/hora específica
                    </label>
                  </div>
                  
                  {useCustomTime && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">Data</label>
                        <Input 
                          type="date" 
                          value={customDate}
                          onChange={(e) => setCustomDate(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">Hora</label>
                        <Input 
                          type="time" 
                          value={customTime}
                          onChange={(e) => setCustomTime(e.target.value)}
                          className="text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
                
                {loadingTraffic && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-zinc-500">
                      <span>Progresso</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>
                )}

                <Button 
                  className="w-full" 
                  variant="default"
                  onClick={fetchTraffic}
                  disabled={segments.length === 0 || loadingTraffic || (useCustomTime && (!customDate || !customTime))}
                >
                  {loadingTraffic ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Coletando...</>
                  ) : (
                    useCustomTime ? 'Obter Trânsito Histórico/Futuro' : 'Obter Agora (Trânsito)'
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  3. Exportar Dados
                </CardTitle>
                <CardDescription>
                  Baixe os resultados em formato CSV para análise.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between text-sm text-zinc-600 mb-4">
                  <span>Trechos com dados:</span>
                  <span className="font-semibold text-zinc-900">{segmentsWithTraffic} / {segments.length}</span>
                </div>
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={downloadCSV}
                  disabled={segments.length === 0}
                >
                  Baixar CSV
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Área do Mapa */}
          <div className="md:col-span-2 h-[600px] rounded-xl overflow-hidden border border-zinc-200 shadow-sm relative bg-white">
            {segments.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400 bg-zinc-50">
                <MapIcon className="w-12 h-12 mb-4 opacity-20" />
                <p>O mapa será exibido aqui após buscar a malha viária.</p>
              </div>
            ) : (
              <MapContainer 
                center={[segments[0].start.lat, segments[0].start.lon]} 
                zoom={13} 
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />
                <MapUpdater segments={segments} />
                
                {segments.map((segment) => (
                  <Polyline
                    key={segment.id}
                    positions={segment.geometry.map(n => [n.lat, n.lon])}
                    color={getSegmentColor(segment)}
                    weight={segment.trafficStatus === 'SUCCESS' ? 4 : 2}
                    opacity={segment.trafficStatus === 'SUCCESS' ? 0.8 : 0.4}
                  />
                ))}
              </MapContainer>
            )}
            
            {/* Legenda do Mapa */}
            {segmentsWithTraffic > 0 && (
              <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur p-3 rounded-lg shadow-md border border-zinc-200 text-xs z-[1000]">
                <div className="font-semibold mb-2">Trânsito</div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span>Livre</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span>Moderado</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span>Lento</span>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
