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

### 3. Configurando as Variáveis de Ambiente
Opcionalmente, você pode configurar uma chave de fallback no servidor. Crie um arquivo `.env` na raiz do projeto:
   ```env
   TOMTOM_API_KEY=sua_chave_api_principal_aqui
   ```

### 4. Iniciando o Servidor
Inicie o servidor em modo de desenvolvimento:
   ```bash
   npm run dev
   ```

5. Abra seu navegador e acesse a aplicação em:
   ```text
   http://localhost:3000
   ```

---

## 🌍 Como Fazer o Deploy (Produção)

Como esta aplicação possui um Front-end (React) e um Back-end (Express/Node.js), a melhor estratégia de deploy gratuito é hospedar cada parte em um serviço otimizado:

### 1. Deploy do Back-end (Render)
1. Crie uma conta no [Render](https://render.com/).
2. Crie um novo **Web Service** conectado ao seu GitHub.
3. Configurações:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Após o deploy, copie a URL gerada (ex: `https://seu-backend.onrender.com`).

### 2. Deploy do Front-end (Netlify)
1. Crie uma conta no [Netlify](https://www.netlify.com/).
2. Adicione um novo site importando do seu GitHub.
3. Configurações de Build:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. **⚠️ IMPORTANTE:** Adicione uma Variável de Ambiente:
   - Vá em *Site configuration > Environment variables*
   - Adicione a chave: `VITE_API_URL`
   - Valor: A URL copiada do Render no passo anterior (sem a barra `/` no final).
5. Faça o Deploy do site.

---

## 🛠️ Como Usar (Guia Rápido)

### 1. Configurando as Chaves da API (Multi-Keys)
Para garantir que suas requisições não sejam bloqueadas pelo limite diário do plano gratuito da TomTom, o sistema suporta o uso de **múltiplas chaves API com rotação automática**:
1. Clique no ícone de engrenagem **(⚙️)** no canto superior direito para abrir o painel de configurações.
2. Clique em **"+ Adicionar Chave"** para cada chave que você possuir.
3. Defina um **Nome** amigável (ex: "Chave 1", "Conta Principal") e insira o respectivo **Valor** da chave.
4. Clique em **"Aplicar Chaves"**.
O sistema tentará usar a primeira chave da lista. Se ela atingir o limite (Erro 403 ou 429), ele tentará automaticamente a chave seguinte.

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
