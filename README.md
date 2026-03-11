# Coletor de Tráfego - Itaipu Parquetec

O **Coletor de Tráfego - Itaipu Parquetec** é uma aplicação web moderna projetada para extrair e analisar dados de mobilidade urbana. Ele permite buscar a malha viária de uma cidade inteira ou de rotas específicas (Ponto A para Ponto B) e enriquecer esses segmentos com dados de trânsito em tempo real usando a API da TomTom.

## Funcionalidades Principais

- **Busca por Cidade**: Extrai todas as vias (baseadas em OpenStreetMap) de uma cidade especificada, processando cruzamentos e segmentando ruas longas.
- **Busca por Rota**: Permite definir um ponto de partida e um ponto de chegada. Opcionalmente, divide a rota sugerida em múltiplos segmentos cruzando dados com o OpenStreetMap para obter nomes reais de ruas, IDs de via (`osmid`) e limites de velocidade.
- **Trânsito em Tempo Real**: Coleta tempos de viagem atuais e tempos estáticos (sem trânsito) diretamente da TomTom Routing API para cada segmento da malha gerada.
- **Visualização Interativa**: Mapa integrado que exibe os segmentos com um mapa de calor dinâmico (Verde = Livre, Amarelo = Moderado, Vermelho = Lento) baseado nas condições de tráfego.
- **Exportação CSV**: Permite baixar todos os dados processados (incluindo geometria, velocidades, tempos de viagem, e IDs de nós do OSM correspondentes) em formato CSV para análise de dados ou uso no modelador de tráfego matriz origem-destino.

---

## 🚀 Como Instalar e Rodar o Projeto

Este projeto é dividido em um front-end (React + Vite) e um back-end (Express + Node.js) rodando juntos sob o pacote `tsx`.

### Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 18 ou superior)
- Navegador Web moderno (Chrome, Firefox, Edge)
- Uma **Chave de API da TomTom** ativa (gratuita pelo [Developer Portal](https://developer.tomtom.com/))

### Passos de Instalação

1. Abra o terminal na pasta do projeto.
2. Instale as dependências:
   ```bash
   npm install
   ```

3. Configure as variáveis de ambiente (opcional, mas recomendado). Crie um arquivo `.env` na raiz do projeto contendo sua chave da TomTom como fallback de segurança:
   ```env
   TOMTOM_API_KEY=sua_chave_api_aqui
   ```

4. Inicie o servidor em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

5. Abra seu navegador e acesse a aplicação em:
   ```text
   http://localhost:3000
   ```

---

## 🛠️ Como Usar (Guia Rápido)

### 1. Configurando a API Key
Antes de realizar qualquer busca, clique no ícone de engrenagem **(⚙️)** no canto superior direito para abrir o painel de configurações. Insira sua **Chave API TomTom** e clique em "Aplicar Chave".

### 2. Escolhendo o Modo de Coleta
No primeiro bloco da tela, escolha a aba correspondente ao formato da pesquisa:

- **Por Cidade:** Digite o nome da cidade (ex: *Foz do Iguaçu*). Ele irá buscar através da Nominatim e Overpass, dividindo todas as vias principais.
- **Por Rota:** Digite Endereço de **Partida** e **Chegada** (ex: *Rua Melro, 402, Foz do Iguaçu* ➔ *Parque Tecnológico Itaipu*). Selecione o botão **"Dividir rota nas intersecções (OSM)"** para que os dados extraídos contenham mais precisão nas paradas, compatível com a modelagem do Itaipu Parquetec.

### 3. Coletando o Trânsito
Uma vez que a malha viária é carregada no mapa:
1. Revise se os trechos representam a via ou local adequado que deseja avaliar.
2. Clique no botão azul **"Obter Agora (Trânsito)"** na segunda coluna.
3. Aguarde o progresso finalizar (processo limitado em lotes de modo automático para não estourar a cota gratuita).

### 4. Exportação
Após os trechos pintarem no mapa de acordo com a velocidade, vá até o terceiro card e clique em **Baixar CSV**. Você receberá um arquivo organizado focado à modelagem analítica com todas as instâncias preenchidas.

---

## Estrutura do Projeto

- `/src/App.tsx`: Interface do usuário, lógica do lado do cliente (React) e interatividade do mapa de calor.
- `/server.ts`: Servidor backend rodando Node+Express com requisições geospaciais ao Nominatim, Overpass (OSM) e cálculo/snapping da Rota TomTom.
- `/package.json`: Scripts e utilitários.
