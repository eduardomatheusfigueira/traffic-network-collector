import express from 'express';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Haversine formula to calculate distance between two points in meters
/**
 * Calcula a distância entre duas coordenadas geográficas (lat/lon) em metros.
 * Utiliza a Fórmula de Haversine para levar em conta a curvatura da Terra.
 * 
 * @param lat1 Latitude do ponto 1
 * @param lon1 Longitude do ponto 1
 * @param lat2 Latitude do ponto 2
 * @param lon2 Longitude do ponto 2
 * @returns Distância em metros
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Raio da Terra em metros
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Resultado em metros
}

/**
 * Calcula o comprimento total de um segmento (linha quebrada) somando a distância
 * entre todos os seus pontos sequenciais.
 * 
 * @param geometry Lista de pontos {lat, lon} que formam o segmento
 * @returns Comprimento total em metros
 */
function calculateSegmentLength(geometry: any[]) {
  let length = 0;
  for (let i = 0; i < geometry.length - 1; i++) {
    length += calculateDistance(
      geometry[i].lat, geometry[i].lon,
      geometry[i+1].lat, geometry[i+1].lon
    );
  }
  return length;
}

/**
 * Determina a velocidade máxima estimada de uma via em km/h.
 * Tenta converter a tag 'maxspeed' do OSM, ou aplica defauts baseados no tipo 'highway'.
 * 
 * @param highwayType Tipo de via do OSM (ex: primary, residential)
 * @param maxspeedTag Valor da tag maxspeed do OSM (opcional)
 * @returns Velocidade em km/h
 */
function getSpeedKph(highwayType: string, maxspeedTag?: string) {
  if (maxspeedTag) {
    const parsed = parseInt(maxspeedTag);
    if (!isNaN(parsed)) return parsed;
  }
  
  // Velocidades padrão baseadas na classificação da via (OSM highway)
  // Valores similares aos adotados pelo OSMnx e padrões urbanos/rodoviários comuns.
  const defaults: Record<string, number> = {
    motorway: 100,
    trunk: 80,
    primary: 60,
    secondary: 50,
    tertiary: 40,
    unclassified: 30,
    residential: 30,
    living_street: 20
  };
  
  return defaults[highwayType] || 30; // 30km/h como fallback conservador
}

const overpassEndpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

/**
 * Função utilitária para chamar a Overpass API (OSM).
 * Possui um mecanismo de retry automático que tenta múltiplos endpoints (mirrors)
 * caso o principal falhe ou sofra timeout, aumentando a robustez da aplicação.
 * 
 * @param query Consulta em formato Overpass QL
 * @param timeoutMs Tempo máximo de espera por tentativa (default 45s)
 * @returns Dados JSON parseados retornados pelo Overpass
 */
async function callOverpassWithRetry(query: string, timeoutMs: number = 45000) {
  let lastError = null;
  for (const endpoint of overpassEndpoints) {
    try {
      console.log(`Trying Overpass API endpoint: ${endpoint}`);
      const response = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: timeoutMs
      });
      
      if (response && response.data && response.data.elements) {
        return response.data;
      }
    } catch (err: any) {
      console.warn(`Endpoint ${endpoint} failed: ${err.message}`);
      lastError = err;
    }
  }
  throw new Error(lastError?.message || 'All Overpass endpoints failed');
}

// ==========================================
// --- API Routes ---
// ==========================================

/**
 * ROTA 1: BUSCA POR CIDADE INTEIRA
 * Extrai toda a malha viária de uma cidade usando Nominatim + Overpass API.
 */
app.post('/api/network', async (req, res) => {
  try {
    const { city, highwayTypes } = req.body;
    
    if (!city) {
      return res.status(400).json({ error: 'City is required' });
    }

    const types = highwayTypes && highwayTypes.length > 0 
      ? highwayTypes.join('|') 
      : 'primary|secondary|tertiary|trunk';

    // Step 1: Geocode the city using Nominatim to get the OSM ID
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`;
    let nominatimResponse;
    try {
      nominatimResponse = await axios.get(nominatimUrl, {
        headers: { 'User-Agent': 'AI-Studio-Applet/1.0' },
        timeout: 15000 // 15 seconds timeout for geocoding
      });
    } catch (err: any) {
      console.error('Nominatim API error:', err.message);
      return res.status(502).json({ error: `Failed to geocode city "${city}" via Nominatim. The service might be down or overloaded. Details: ${err.message}` });
    }

    if (!nominatimResponse.data || nominatimResponse.data.length === 0) {
      return res.status(404).json({ error: `City "${city}" not found by Nominatim.` });
    }

    const place = nominatimResponse.data[0];
    let areaId;
    if (place.osm_type === 'relation') {
      areaId = parseInt(place.osm_id) + 3600000000;
    } else if (place.osm_type === 'way') {
      areaId = parseInt(place.osm_id) + 2400000000;
    } else {
      return res.status(400).json({ error: 'Found location is not a valid area (must be relation or way).' });
    }

    // Step 2: Overpass QL query using the calculated area ID
    const query = `
      [out:json][timeout:45];
      area(${areaId})->.searchArea;
      (
        way["highway"~"${types}"](area.searchArea);
      );
      out body;
      >;
      out skel qt;
    `;

    const data = await callOverpassWithRetry(query);
    
    // Process OSM data into segments
    const nodeMap = new Map();
    const ways = [];
    const nodeFrequencies = new Map();

    // First pass: categorize elements
    for (const element of data.elements) {
      if (element.type === 'node') {
        nodeMap.set(element.id, { lat: element.lat, lon: element.lon });
      } else if (element.type === 'way') {
        ways.push(element);
        // Count node frequencies to find intersections
        for (const nodeId of element.nodes) {
          nodeFrequencies.set(nodeId, (nodeFrequencies.get(nodeId) || 0) + 1);
        }
      }
    }

    const segments = [];
    let segmentCounter = 0;

    // Second pass: break ways into segments
    for (const way of ways) {
      let currentSegmentNodes = [];
      
      for (let i = 0; i < way.nodes.length; i++) {
        const nodeId = way.nodes[i];
        currentSegmentNodes.push(nodeId);

        const isIntersection = (nodeFrequencies.get(nodeId) || 0) > 1;
        const isFirstNode = i === 0;
        const isLastNode = i === way.nodes.length - 1;

        if ((isIntersection || isLastNode) && currentSegmentNodes.length > 1) {
          const startNode = nodeMap.get(currentSegmentNodes[0]);
          const endNode = nodeMap.get(currentSegmentNodes[currentSegmentNodes.length - 1]);
          
          if (startNode && endNode) {
            const geometry = currentSegmentNodes.map(id => nodeMap.get(id)).filter(Boolean);
            const lengthMeters = calculateSegmentLength(geometry);
            const highwayType = way.tags?.highway || 'unknown';
            const speedKph = getSpeedKph(highwayType, way.tags?.maxspeed);
            const travelTimeSeconds = lengthMeters / (speedKph * 1000 / 3600);

            segments.push({
              id: `seg_${way.id}_${segmentCounter++}`,
              u: currentSegmentNodes[0],
              v: currentSegmentNodes[currentSegmentNodes.length - 1],
              osmid: way.id,
              name: way.tags?.name || 'Unnamed Road',
              highway: highwayType,
              start: startNode,
              end: endNode,
              geometry: geometry,
              length: lengthMeters,
              speed_kph: speedKph,
              travel_time: travelTimeSeconds
            });
          }
          
          // Start next segment with the current node
          currentSegmentNodes = [nodeId];
        }
      }
    }

    res.json({ segments });
  } catch (error: any) {
    console.error('Error fetching network:', error.message);
    res.status(500).json({ error: `Failed to fetch road network: ${error.message}` });
  }
});

/**
 * ROTA 1.5: BUSCA DE REDE POR ROTA (A -> B)
 * Recebe origem e destino, converte em coordenadas (Nominatim), traça a rota ideal (TomTom),
 * e cruza a geometria dessa rota com as vias do OSM (Overpass) para enriquecer com 
 * nomes de ruas reais e limites de velocidade.
 */
app.post('/api/network/route', async (req, res) => {
  try {
    const { origin, destination, travelMode, splitIntersections, apiKey: clientApiKey } = req.body;
    console.log(`Fetching route from "${origin}" to "${destination}"...`);
    const apiKey = clientApiKey || process.env.TOMTOM_API_KEY;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Ponto de partida e chegada são necessários.' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'Chave API TomTom não configurada.' });
    }

    // Helper for geocoding
    const geocode = async (query: string) => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'AI-Studio-Applet/1.0' },
        timeout: 15000
      });
      if (!response.data || response.data.length === 0) {
        throw new Error(`Local não encontrado: ${query}`);
      }
      return {
        lat: parseFloat(response.data[0].lat),
        lon: parseFloat(response.data[0].lon),
        display_name: response.data[0].display_name
      };
    };

    const startLoc = await geocode(origin);
    const endLoc = await geocode(destination);

    // TomTom Routing
    const ttMode = travelMode || 'car';
    const ttUrl = `https://api.tomtom.com/routing/1/calculateRoute/${startLoc.lat},${startLoc.lon}:${endLoc.lat},${endLoc.lon}/json?key=${apiKey}&travelMode=${ttMode}&routeType=fastest`;
    
    const ttResponse = await axios.get(ttUrl);
    const route = ttResponse.data.routes[0];
    if (!route) return res.status(404).json({ error: 'Nenhuma rota encontrada.' });

    const points = route.legs[0].points.map((p: any) => ({ lat: p.latitude, lon: p.longitude }));
    const totalLength = route.summary.lengthInMeters;
    const totalTime = route.summary.travelTimeInSeconds;

    if (!splitIntersections) {
      // Se não for para dividir, retorna a rota como um trecho único
      return res.json({
        segments: [{
          id: `route_${Date.now()}`,
          u: 'start',
          v: 'end',
          name: `${origin} ➔ ${destination}`,
          highway: 'route',
          start: points[0],
          end: points[points.length - 1],
          geometry: points,
          length: totalLength,
          speed_kph: (totalLength / totalTime) * 3.6, // m/s para km/h
          travel_time: totalTime
        }]
      });
    }

    // Lógica de Segmentação: Quebra a rota sempre que cruzar um nó (intersecção) real do OSM
    const lats = points.map(p => p.lat);
    const lons = points.map(p => p.lon);
    // Increased bbox slightly and getting full way data
    const query = `
      [out:json][timeout:30];
      way["highway"~"primary|secondary|tertiary|trunk|motorway|residential"](${Math.min(...lats)-0.002},${Math.min(...lons)-0.002},${Math.max(...lats)+0.002},${Math.max(...lons)+0.002});
      out body;
      node(w);
      out skel;
    `;
    
    let osmNodes = [];
    let osmWays = [];
    try {
      const overpassData = await callOverpassWithRetry(query, 30000);
      osmNodes = overpassData.elements.filter((e: any) => e.type === 'node');
      osmWays = overpassData.elements.filter((e: any) => e.type === 'way');
    } catch (err: any) {
      console.warn('Overpass segmentation failed, continuing with single segment:', err.message);
    }
    
    const segments = [];
    let currentSegmentPoints = [points[0]];
    const SNAP_DIST = 20; // Tolerância de 20 metros para acoplar (snap) o traçado TomTom aos nós do OSM
    
    // Procura o ID do nó OSM estruturalmente mais próximo do ponto de partida da rota
    let currentU = osmNodes.length > 0 ? 
      osmNodes.reduce((prev, curr) => 
        calculateDistance(points[0].lat, points[0].lon, curr.lat, curr.lon) < 
        calculateDistance(points[0].lat, points[0].lon, prev.lat, prev.lon) ? curr : prev
      ).id : `start_${Date.now()}`;

    /**
     * Helper interno para encontrar os metadados reais da rua (OSM Way)
     * avaliando a distância do ponto médio do traçado em relação aos nós das vias.
     */
    const getBestWayMetadata = (p1: any, p2: any) => {
      if (osmWays.length === 0) return { name: `${origin} ➔ ${destination}`, highway: 'route_part' };
      const midLat = (p1.lat + p2.lat) / 2;
      const midLon = (p1.lon + p2.lon) / 2;
      
      let closestWay = null;
      let minDist = Infinity;
      
      for (const way of osmWays) {
        const wayNodes = way.nodes || [];
        // Para ganho de performance, checa no máximo 5 nós distribuídos ao longo da via OSM
        const step = Math.max(1, Math.min(2, Math.floor(wayNodes.length / 5)));
        for (let i = 0; i < wayNodes.length; i += step) {
          const node = osmNodes.find(n => n.id === wayNodes[i]);
          if (node) {
            const d = calculateDistance(midLat, midLon, node.lat, node.lon);
            if (d < minDist) {
              minDist = d; // Via mais próxima encontrada
              closestWay = way;
            }
          }
        }
      }

      if (!closestWay) return { name: `${origin} ➔ ${destination}`, highway: 'route_part' };

      const name = closestWay.tags?.name || 'Unnamed Road';
      const highway = closestWay.tags?.highway || 'route_part';
      const osmid = closestWay.id;
      const speed_kph = getSpeedKph(highway, closestWay.tags?.maxspeed);

      return { name, highway, osmid, speed_kph };
    };

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      currentSegmentPoints.push(p);

      if (i < points.length - 1) {
        // Find if this point is an intersection
        const nearestNode = osmNodes.find(n => calculateDistance(p.lat, p.lon, n.lat, n.lon) < SNAP_DIST);
        
        if (nearestNode && currentSegmentPoints.length > 8) { 
          const len = calculateSegmentLength(currentSegmentPoints);
          const metadata = getBestWayMetadata(currentSegmentPoints[0], p);
          const speed = metadata.speed_kph || 40;
          segments.push({
            id: `route_seg_${segments.length}_${Date.now()}`,
            u: currentU,
            v: nearestNode.id,
            osmid: metadata.osmid,
            name: metadata.name,
            highway: metadata.highway,
            geometry: [...currentSegmentPoints],
            length: len,
            speed_kph: speed,
            travel_time: (len / 1000) / speed * 3600,
            start: currentSegmentPoints[0],
            end: currentSegmentPoints[currentSegmentPoints.length - 1]
          });
          currentSegmentPoints = [p];
          currentU = nearestNode.id;
        }
      }
    }
    
    // Last segment
    if (currentSegmentPoints.length > 1) {
      const len = calculateSegmentLength(currentSegmentPoints);
      const lastPoint = currentSegmentPoints[currentSegmentPoints.length - 1];
      const finalVNode = osmNodes.length > 0 ? 
        osmNodes.reduce((prev, curr) => 
          calculateDistance(lastPoint.lat, lastPoint.lon, curr.lat, curr.lon) < 
          calculateDistance(lastPoint.lat, lastPoint.lon, prev.lat, prev.lon) ? curr : prev
        ).id : `end_${Date.now()}`;

      const metadata = getBestWayMetadata(currentSegmentPoints[0], lastPoint);
      const speed = metadata.speed_kph || 40;
      segments.push({
        id: `route_seg_final_${Date.now()}`,
        u: currentU,
        v: finalVNode,
        osmid: metadata.osmid,
        name: metadata.name,
        highway: metadata.highway,
        geometry: currentSegmentPoints,
        length: len,
        speed_kph: speed,
        travel_time: (len / 1000) / speed * 3600,
        start: currentSegmentPoints[0],
        end: currentSegmentPoints[currentSegmentPoints.length - 1]
      });
    }

    res.json({ segments });
  } catch (error: any) {
    console.error('Error fetching route network:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * ROTA 2: COLETA DE TRÂNSITO (TomTom Routing API)
 * Recebe um array de segmentos geográficos e consulta a TomTom para obter 
 * o tempo atual de viagem (com trânsito) vs tempo estático (via livre).
 */
app.post('/api/traffic', async (req, res) => {
  try {
    const { segments, departAt, apiKey: clientApiKey } = req.body;
    const apiKey = clientApiKey || process.env.TOMTOM_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'TomTom API Key is not configured. Please provide it in settings.' });
    }

    if (!segments || !Array.isArray(segments)) {
      return res.status(400).json({ error: 'Segments array is required' });
    }

    // Limite de segurança: evita estourar a cota gratuita da API enviando milhares de reqs
    const maxSegments = Math.min(segments.length, 100);
    const results = [];

    // Processamento em lotes (Promise.all limitando concorrência)
    // Evita erro de 'Too Many Requests' ou timeout de socket no Node
    const concurrencyLimit = 5;
    
    for (let i = 0; i < maxSegments; i += concurrencyLimit) {
      const batch = segments.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (segment) => {
        try {
          const url = `https://api.tomtom.com/routing/1/calculateRoute/${segment.start.lat},${segment.start.lon}:${segment.end.lat},${segment.end.lon}/json`;
          
          const params: any = {
            key: apiKey,
            traffic: true,
            computeTravelTimeFor: 'all',
            routeType: 'fastest'
          };

          if (departAt) {
            params.departAt = departAt;
          }

          const response = await axios.get(url, { params });

          const summary = response.data.routes?.[0]?.summary;
          return {
            ...segment,
            distanceMeters: summary?.lengthInMeters || null,
            duration: summary?.travelTimeInSeconds ? `${summary.travelTimeInSeconds}s` : null,
            staticDuration: summary?.noTrafficTravelTimeInSeconds ? `${summary.noTrafficTravelTimeInSeconds}s` : null,
            trafficStatus: summary ? 'SUCCESS' : 'NO_ROUTE',
            timestamp: departAt || new Date().toISOString()
          };
        } catch (err: any) {
          console.error(`Error fetching route for segment ${segment.id}:`, err.response?.data || err.message);
          return {
            ...segment,
            trafficStatus: 'ERROR',
            error: err.response?.data?.errorText || err.message,
            timestamp: new Date().toISOString()
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay to respect rate limits (TomTom allows 5 QPS on free tier)
      if (i + concurrencyLimit < maxSegments) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.json({ results, totalProcessed: results.length, totalRequested: segments.length });
  } catch (error: any) {
    console.error('Error fetching traffic:', error.message);
    res.status(500).json({ error: 'Failed to fetch traffic data' });
  }
});

// --- Vite Middleware ---

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`Server v2.0 - Metadata Enrichment Active`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`=========================================`);
  });
}

startServer();
