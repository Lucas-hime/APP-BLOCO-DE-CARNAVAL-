const LOCATION_KEY = 'blocosrj.location';
const WEATHER_KEY = 'blocosrj.weather';
const RESULTS_KEY = 'blocosrj.results';
const PLAN_KEY = 'blocosrj_planning';
const GEO_CACHE_KEY = 'blocosrj.geocode-cache';
const LOCATION_TIMEOUT_MS = 10000;
const NEARBY_RADIUS_KM = 2;

const state = {
  userLocation: null,
  pendingLocation: null,
  blocos: [],
  metroStations: [],
  selectedBloco: null,
  currentResults: [],
  planningIds: new Set(),
  geocodeCache: {},
};

const els = {
  locationStatus: document.getElementById('location-status'),
  locationCoords: document.getElementById('location-coords'),
  changeLocation: document.getElementById('change-location'),
  requestGps: document.getElementById('request-gps'),
  retryLocation: document.getElementById('retry-location'),
  locationConfirmation: document.getElementById('location-confirmation'),
  pendingLocationLabel: document.getElementById('pending-location-label'),
  confirmManualLocation: document.getElementById('confirm-manual-location'),
  cancelManualLocation: document.getElementById('cancel-manual-location'),
  modal: document.getElementById('location-modal'),
  manualForm: document.getElementById('manual-location-form'),
  manualInput: document.getElementById('manual-location-input'),
  cancelManualModal: document.getElementById('cancel-manual-modal'),
  weatherContent: document.getElementById('weather-content'),
  refreshWeather: document.getElementById('refresh-weather'),
  nearbyBtn: document.getElementById('nearby-btn'),
  nextHoursBtn: document.getElementById('next-hours-btn'),
  allBlocosBtn: document.getElementById('all-blocos-btn'),
  clearResults: document.getElementById('clear-results'),
  results: document.getElementById('results'),
  cardTemplate: document.getElementById('bloco-card-template'),
  selectionSection: document.getElementById('selection-section'),
  selectedTitle: document.getElementById('selected-title'),
  confirmBloco: document.getElementById('confirm-bloco'),
  saveSelectedBloco: document.getElementById('save-selected-bloco'),
  shareBloco: document.getElementById('share-bloco'),
  planningList: document.getElementById('planning-list'),
  planningCatalog: document.getElementById('planning-catalog'),
  loadPlanningBase: document.getElementById('load-planning-base'),
  sharePlanning: document.getElementById('share-planning'),
  clearPlanning: document.getElementById('clear-planning'),
};

init();

function init() {
  registerServiceWorker();
  bindEvents();
  restoreCachedWeather();
  restoreCachedResults();
  restorePlanning();
  restoreGeocodeCache();
  detectLocation();
}

function bindEvents() {
  els.changeLocation.addEventListener('click', openManualLocationModal);
  els.requestGps.addEventListener('click', detectLocation);
  els.retryLocation.addEventListener('click', detectLocation);
  els.refreshWeather.addEventListener('click', fetchWeather);
  els.nearbyBtn.addEventListener('click', () => withButtonLoading(els.nearbyBtn, findNearbyBlocos));
  els.nextHoursBtn.addEventListener('click', () => withButtonLoading(els.nextHoursBtn, findNextHoursBlocos));
  els.allBlocosBtn.addEventListener('click', () => withButtonLoading(els.allBlocosBtn, listAllBlocos));
  els.clearResults.addEventListener('click', clearResults);
  els.confirmBloco.addEventListener('click', () => {
    if (!state.selectedBloco) return;
    addBlocoToPlanning(state.selectedBloco);
    alert(`Boa! ${state.selectedBloco.nome_bloco} foi salvo no seu planejamento 🎉`);
  });
  els.saveSelectedBloco.addEventListener('click', () => {
    if (!state.selectedBloco) return;
    addBlocoToPlanning(state.selectedBloco);
  });
  els.shareBloco.addEventListener('click', shareSelectedBloco);
  els.loadPlanningBase.addEventListener('click', renderPlanningCatalog);
  els.sharePlanning.addEventListener('click', sharePlanningList);
  els.clearPlanning.addEventListener('click', clearPlanning);

  els.cancelManualModal.addEventListener('click', () => {
    els.manualForm.reset();
    if (typeof els.modal.close === 'function') {
      els.modal.close();
    } else {
      els.modal.removeAttribute('open');
    }
  });

  els.manualForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = els.manualInput.value.trim();
    if (!query) {
      alert('Digite um bairro ou endereço.');
      return;
    }
    await prepareManualLocation(query);
    if (typeof els.modal.close === 'function') {
      els.modal.close();
    } else {
      els.modal.removeAttribute('open');
    }
    els.manualForm.reset();
  });

  els.confirmManualLocation.addEventListener('click', () => {
    if (!state.pendingLocation) return;
    const pending = state.pendingLocation;
    setUserLocation(pending.latitude, pending.longitude, pending.source, pending.label);
    els.locationStatus.textContent = 'Localização manual confirmada com sucesso';
    clearPendingLocation();
    fetchWeather();
  });

  els.cancelManualLocation.addEventListener('click', clearPendingLocation);
}

async function withButtonLoading(button, handler) {
  if (button.disabled) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Carregando...';

  try {
    await handler();
  } catch (error) {
    console.error('[BlocosRJ] Action button failed:', error);
    alert('Não foi possível completar esta ação agora. Tente novamente.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function openManualLocationModal() {
  if (typeof els.modal.showModal === 'function') {
    if (!els.modal.open) {
      els.modal.showModal();
    }
    return;
  }

  els.modal.setAttribute('open', 'open');
}

function detectLocation() {
  els.locationStatus.textContent = 'Buscando localização...';
  clearPendingLocation();

  if (!navigator.geolocation) {
    setLocationUnavailable('Localização automática indisponível neste dispositivo.');
    if (!useSavedLocation('Usando última localização conhecida')) {
      openManualLocationModal();
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      setUserLocation(latitude, longitude, 'GPS automático');
      els.locationStatus.textContent = 'Localização detectada com sucesso';
      fetchWeather();
    },
    (error) => {
      if (error?.code === 1) {
        setLocationUnavailable('Permissão de localização negada. Informe o endereço manualmente para continuar.');
      } else if (error?.code === 3) {
        setLocationUnavailable('Tempo esgotado para localizar via GPS.');
      } else {
        setLocationUnavailable('Não foi possível detectar sua localização automática.');
      }

      if (useSavedLocation('Usando última localização conhecida')) {
        return;
      }

      openManualLocationModal();
    },
    { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
  );
}

function useSavedLocation(statusMessage = 'Localização carregada do armazenamento') {
  const saved = localStorage.getItem(LOCATION_KEY);
  if (!saved) return false;

  try {
    const parsed = JSON.parse(saved);
    if (Number.isFinite(parsed?.latitude) && Number.isFinite(parsed?.longitude)) {
      setUserLocation(parsed.latitude, parsed.longitude, parsed.source || 'salva', parsed.label);
      els.locationStatus.textContent = statusMessage;
      fetchWeather();
      return true;
    }
  } catch (_) {
    // ignore
  }

  return false;
}

async function prepareManualLocation(query) {
  els.locationStatus.textContent = 'Buscando localização manual...';
  try {
    const result = await geocodeQuery(query) || await geocodeQuery(`${query}, Brasil`);
    if (!result) {
      state.pendingLocation = null;
      clearPendingLocation();
      setLocationUnavailable('Localização não encontrada para esse endereço.');
      return;
    }

    state.pendingLocation = {
      latitude: result.latitude,
      longitude: result.longitude,
      source: `manual: ${query}`,
      label: result.label,
    };

    els.pendingLocationLabel.textContent = `${result.label} • Lat ${result.latitude.toFixed(5)} • Lng ${result.longitude.toFixed(5)}`;
    els.locationConfirmation.classList.remove('hidden');
    els.locationStatus.textContent = 'Confirme se este ponto está correto (estilo app de corrida).';
  } catch (_) {
    state.pendingLocation = null;
    clearPendingLocation();
    setLocationUnavailable('Falha ao buscar localização manual. Digite novamente em alguns segundos.');
  }
}

function clearPendingLocation() {
  state.pendingLocation = null;
  els.locationConfirmation.classList.add('hidden');
  els.pendingLocationLabel.textContent = '';
}

function setUserLocation(latitude, longitude, source, label = null) {
  state.userLocation = { latitude, longitude, source, label };
  localStorage.setItem(LOCATION_KEY, JSON.stringify(state.userLocation));
  els.locationCoords.textContent = `Lat ${latitude.toFixed(5)} • Lng ${longitude.toFixed(5)} (${source})${label ? ` • ${label}` : ''}`;
  els.refreshWeather.disabled = false;
}

function setLocationUnavailable(message) {
  els.locationStatus.textContent = message;
  els.refreshWeather.disabled = !state.userLocation;
}

async function fetchWeather() {
  if (!state.userLocation) return;
  const { latitude, longitude } = state.userLocation;
  const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature&hourly=precipitation_probability&timezone=auto&forecast_days=1`;

  try {
    const response = await fetch(weatherURL);
    const data = await response.json();
    const weather = {
      temp: data.current?.temperature_2m,
      apparent: data.current?.apparent_temperature,
      rainProbability: getMaxRainNextHours(data.hourly),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(WEATHER_KEY, JSON.stringify(weather));
    renderWeather(weather);
  } catch (_) {
    restoreCachedWeather(true);
  }
}

function getMaxRainNextHours(hourly) {
  if (!hourly?.time || !hourly?.precipitation_probability) return null;
  const now = Date.now();
  const maxWindow = now + 3 * 60 * 60 * 1000;
  let maxProb = null;

  hourly.time.forEach((iso, idx) => {
    const time = new Date(iso).getTime();
    if (time >= now && time <= maxWindow) {
      const prob = hourly.precipitation_probability[idx];
      maxProb = maxProb === null ? prob : Math.max(maxProb, prob);
    }
  });

  return maxProb;
}

function restoreCachedWeather(fromError = false) {
  const cached = localStorage.getItem(WEATHER_KEY);
  if (!cached) return;
  try {
    renderWeather(JSON.parse(cached), fromError);
  } catch (_) {
    // ignore
  }
}

function renderWeather(weather, stale = false) {
  els.weatherContent.innerHTML = `
    <p>🌡️ Temperatura: <strong>${weather.temp ?? '--'}°C</strong></p>
    <p>🥵 Sensação térmica: <strong>${weather.apparent ?? '--'}°C</strong></p>
    <p>☔ Chuva (próximas horas): <strong>${weather.rainProbability ?? '--'}%</strong></p>
    <p class="muted">${stale ? 'Mostrando clima salvo offline.' : 'Atualizado em'} ${new Date(weather.updatedAt).toLocaleString('pt-BR')}</p>
  `;
}

async function ensureDataLoaded() {
  const [blocos, stations] = await Promise.all([loadBlocosData(), loadMetroStations()]);
  state.blocos = blocos;
  state.metroStations = stations;
}

async function loadBlocosData() {
  try {
    const csvResponse = await fetch('blocos.csv', { cache: 'no-store' });
    console.log('[BlocosRJ] CSV fetch status:', csvResponse.status, csvResponse.statusText);
    if (!csvResponse.ok) throw new Error(`Falha ao carregar CSV: ${csvResponse.status}`);

    const csvText = await csvResponse.text();
    console.log('[BlocosRJ] CSV content length:', csvText.length);
    const parsedRows = parseCSV(csvText);
    console.log('[BlocosRJ] Parsed CSV rows:', parsedRows.length);
    if (!parsedRows.length) {
      console.warn('[BlocosRJ] CSV loaded but no usable rows were parsed.');
    }
    return parsedRows;
  } catch (error) {
    console.warn('[BlocosRJ] Failed to fetch latest CSV.', error);
    return state.blocos || [];
  }
}

async function loadMetroStations() {
  if (state.metroStations.length) return state.metroStations;

  try {
    const metroResponse = await fetch('metro_stations.json', { cache: 'no-store' });
    if (!metroResponse.ok) throw new Error(`Falha ao carregar estações de metrô: ${metroResponse.status}`);
    return await metroResponse.json();
  } catch (error) {
    console.warn('[BlocosRJ] Metro load failed.', error);
    return [];
  }
}

function parseCSV(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const headerLine = lines.shift();
  if (!headerLine) return [];

  const separator = detectSeparator(headerLine);
  if (!separator) return [];

  const headers = splitCSVLine(headerLine, separator).map((header) => normalizeHeaderKey(header.trim()));

  return lines
    .map((line) => {
      const values = splitCSVLine(line, separator).map((value) => value.trim());
      if (values.every((value) => value === '')) return null;

      const bloco = {};
      headers.forEach((header, idx) => {
        bloco[header] = values[idx] ?? '';
      });

      bloco.nome_bloco = bloco.nome_bloco || bloco.nome || '';
      bloco.endereco_concentracao = bloco.endereco_concentracao || bloco.endereco || bloco.endereco_bloco || '';
      bloco.bairro = bloco.bairro || '';
      bloco.data = bloco.data || '';
      bloco.hora_concentracao = bloco.hora_concentracao || bloco.hora || bloco.horario_inicio || bloco.horario || '';
      bloco.latitude = parseCoordinate(bloco.latitude);
      bloco.longitude = parseCoordinate(bloco.longitude);
      bloco.locationApproximate = false;

      if (!bloco.nome_bloco || !bloco.endereco_concentracao || !bloco.hora_concentracao) {
        return null;
      }

      bloco._id = buildBlocoId(bloco);
      return bloco;
    })
    .filter(Boolean);
}

function detectSeparator(headerLine) {
  const candidates = [',', ';', '\t'];
  let best = null;

  for (const separator of candidates) {
    const columns = splitCSVLine(headerLine, separator);
    if (!best || columns.length > best.columns.length) {
      best = { separator, columns };
    }
  }

  return best && best.columns.length > 1 ? best.separator : null;
}

function normalizeHeaderKey(header) {
  const key = header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');

  const alias = {
    nome: 'nome_bloco',
    bloco: 'nome_bloco',
    nome_do_bloco: 'nome_bloco',
    endereco: 'endereco_concentracao',
    endereco_da_concentracao: 'endereco_concentracao',
    hora: 'hora_concentracao',
    horario_inicio: 'hora_concentracao',
    horario: 'hora_concentracao',
    endereco_bloco: 'endereco_concentracao',
    lat: 'latitude',
    lng: 'longitude',
    lon: 'longitude',
  };

  return alias[key] || key;
}

function parseCoordinate(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCSVLine(line, separator = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === separator && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

async function findNearbyBlocos() {
  if (!state.userLocation) {
    alert('Ative ou informe sua localização antes de buscar blocos em até 2 km.');
    return;
  }

  renderResultsLoading();
  await ensureDataLoaded();
  if (!state.blocos.length) {
    renderNoDataMessage('Nenhum bloco foi encontrado na base de dados atual.');
    return;
  }
  const blocosWithCoords = await enrichBlocosWithCoordinates(state.blocos);

  const matches = blocosWithCoords
    .filter((bloco) => Number.isFinite(bloco.latitude) && Number.isFinite(bloco.longitude))
    .map((bloco) => ({
      ...bloco,
      distance: haversine(state.userLocation.latitude, state.userLocation.longitude, bloco.latitude, bloco.longitude),
      metro: findNearestMetro(bloco),
    }))
    .filter((bloco) => bloco.distance <= NEARBY_RADIUS_KM)
    .sort((a, b) => a.distance - b.distance);

  console.log('[BlocosRJ] Total blocos loaded:', state.blocos.length);
  console.log('[BlocosRJ] Blocos within 2km:', matches.length);
  renderResults(matches, 'nearby');
}

async function findNextHoursBlocos() {
  await ensureDataLoaded();
  if (!state.blocos.length) {
    renderNoDataMessage('Nenhum bloco foi encontrado na base de dados atual.');
    return;
  }
  const now = new Date();
  const limit = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const blocosWithCoords = await enrichBlocosWithCoordinates(state.blocos);

  const matches = blocosWithCoords
    .filter((bloco) => isInNextHours(bloco.data, bloco.hora_concentracao, now, limit))
    .map((bloco) => ({
      ...bloco,
      distance: state.userLocation && Number.isFinite(bloco.latitude) && Number.isFinite(bloco.longitude)
        ? haversine(state.userLocation.latitude, state.userLocation.longitude, bloco.latitude, bloco.longitude)
        : null,
      metro: findNearestMetro(bloco),
    }))
    .sort((a, b) => (toDate(a.data, a.hora_concentracao)?.getTime() || 0) - (toDate(b.data, b.hora_concentracao)?.getTime() || 0));

  console.log('[BlocosRJ] Blocos within next 3h:', matches.length);
  renderResults(matches, 'next3h');
}

async function listAllBlocos() {
  await ensureDataLoaded();
  if (!state.blocos.length) {
    renderNoDataMessage('Nenhum bloco foi encontrado na base de dados atual.');
    return;
  }
  const blocosWithCoords = await enrichBlocosWithCoordinates(state.blocos);

  const all = blocosWithCoords
    .map((bloco) => ({
      ...bloco,
      distance: state.userLocation && Number.isFinite(bloco.latitude) && Number.isFinite(bloco.longitude)
        ? haversine(state.userLocation.latitude, state.userLocation.longitude, bloco.latitude, bloco.longitude)
        : null,
      metro: findNearestMetro(bloco),
    }))
    .sort((a, b) => (toDate(a.data, a.hora_concentracao)?.getTime() || 0) - (toDate(b.data, b.hora_concentracao)?.getTime() || 0));

  renderResults(all, 'all');
}

async function enrichBlocosWithCoordinates(blocos) {
  const enriched = [];

  for (const bloco of blocos) {
    const item = { ...bloco };

    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      const geocoded = await geocodeBlocoAddress(item);
      if (geocoded) {
        item.latitude = geocoded.latitude;
        item.longitude = geocoded.longitude;
      } else {
        item.locationApproximate = true;
      }
    }

    enriched.push(item);
  }

  return enriched;
}

async function geocodeBlocoAddress(bloco) {
  const rawAddress = [bloco.endereco_concentracao, bloco.bairro, 'Rio de Janeiro'].filter(Boolean).join(', ');
  if (!rawAddress) return null;

  const cacheKey = `bloco:${rawAddress.toLowerCase()}`;
  if (state.geocodeCache[cacheKey]) return state.geocodeCache[cacheKey];

  const result = await geocodeQuery(rawAddress);
  if (result) {
    const coords = { latitude: result.latitude, longitude: result.longitude };
    state.geocodeCache[cacheKey] = coords;
    persistGeocodeCache();
    return coords;
  }

  return null;
}


function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function geocodeQuery(query, attempt = 1) {
  const cacheKey = `query:${query.toLowerCase()}`;
  if (state.geocodeCache[cacheKey]) return state.geocodeCache[cacheKey];

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Geocoding status ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data) || !data.length) return null;

    const result = {
      latitude: Number(data[0].lat),
      longitude: Number(data[0].lon),
      label: data[0].display_name,
    };

    if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) return null;

    state.geocodeCache[cacheKey] = result;
    persistGeocodeCache();
    return result;
  } catch (error) {
    if (attempt >= 3) {
      return null;
    }

    els.locationStatus.textContent = 'Tentando novamente...';
    await sleep((2 ** attempt) * 500);
    return geocodeQuery(query, attempt + 1);
  }
}

function isInNextHours(dateText, hourText, start, end) {
  const blocoDate = toDate(dateText, hourText);
  if (!blocoDate) return false;
  return blocoDate >= start && blocoDate <= end;
}

function toDate(dateText, hourText) {
  if (!dateText || !hourText) return null;

  const cleanDate = String(dateText).trim();
  let day;
  let month;
  let year;

  if (cleanDate.includes('/')) {
    [day, month, year] = cleanDate.split('/').map(Number);
  } else if (cleanDate.includes('-')) {
    const pieces = cleanDate.split('-').map(Number);
    if (pieces[0] > 999) {
      [year, month, day] = pieces;
    } else {
      [day, month, year] = pieces;
    }
  }

  const [hour, minute] = String(hourText).split(':').map(Number);
  if ([day, month, year, hour, minute].some(Number.isNaN)) return null;
  return new Date(year, month - 1, day, hour, minute, 0);
}

function findNearestMetro(bloco) {
  if (!Number.isFinite(bloco.latitude) || !Number.isFinite(bloco.longitude)) {
    return '🚇 Metrô mais próximo da concentração: coordenadas do bloco ausentes';
  }

  let nearest = null;
  for (const station of state.metroStations) {
    const d = haversine(bloco.latitude, bloco.longitude, station.latitude, station.longitude);
    if (!nearest || d < nearest.distance) {
      nearest = { name: station.name, distance: d };
    }
  }

  if (!nearest) {
    return '🚇 Metrô mais próximo da concentração: Indefinido';
  }

  return `🚇 Metrô mais próximo da concentração: ${nearest.name} (${nearest.distance.toFixed(2)} km)`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


function renderNoDataMessage(message) {
  els.results.innerHTML = `<p class="card">${message}</p>`;
}

function renderResultsLoading() {
  els.results.innerHTML = '<p class="card">Buscando blocos...</p>';
}

function renderResults(list, mode) {
  state.currentResults = list;
  els.results.innerHTML = '';

  if (!list.length) {
    els.results.innerHTML = '<p class="card">Nenhum bloco encontrado para este filtro.</p>';
    localStorage.setItem(RESULTS_KEY, JSON.stringify({ mode, list, timestamp: Date.now() }));
    return;
  }

  list.forEach((bloco) => {
    const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.bloco-name').textContent = bloco.nome_bloco;
    node.querySelector('.bloco-distance').textContent = bloco.distance != null
      ? `📏 Distância: ${bloco.distance.toFixed(2)} km`
      : '📏 Distância: indisponível sem localização';
    node.querySelector('.bloco-time').textContent = `${bloco.data || '--'} ${bloco.hora_concentracao || '--'}`;
    node.querySelector('.bloco-address').textContent = `${bloco.endereco_concentracao || 'Endereço não informado'}${bloco.locationApproximate ? ' • localização aproximada' : ''}`;
    const bairroNode = node.querySelector('.bloco-bairro');
    if (bairroNode) bairroNode.textContent = bloco.bairro || 'Bairro não informado';
    node.querySelector('.bloco-metro').textContent = bloco.metro;

    const saveBtn = node.querySelector('.bloco-save');
    if (state.planningIds.has(bloco._id)) {
      saveBtn.textContent = '✅ Já salvo';
      saveBtn.disabled = true;
    }

    saveBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      addBlocoToPlanning(bloco);
      saveBtn.textContent = '✅ Já salvo';
      saveBtn.disabled = true;
    });

    node.addEventListener('click', () => selectBloco(bloco));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectBloco(bloco);
      }
    });

    els.results.appendChild(node);
  });

  localStorage.setItem(RESULTS_KEY, JSON.stringify({ mode, list, timestamp: Date.now() }));
}

function clearResults() {
  state.currentResults = [];
  els.results.innerHTML = '';
  state.selectedBloco = null;
  els.selectionSection.classList.add('hidden');
  localStorage.removeItem(RESULTS_KEY);
}

function restoreCachedResults() {
  const cached = localStorage.getItem(RESULTS_KEY);
  if (!cached) return;

  try {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed.list)) {
      renderResults(parsed.list, parsed.mode);
    }
  } catch (_) {
    // ignore
  }
}

function selectBloco(bloco) {
  state.selectedBloco = bloco;
  els.selectionSection.classList.remove('hidden');
  els.selectedTitle.textContent = `Você vai para: ${bloco.nome_bloco}`;
}

function buildBlocoId(bloco) {
  return `${bloco.nome_bloco}|${bloco.data}|${bloco.hora_concentracao}|${bloco.endereco_concentracao}`.toLowerCase();
}

function addBlocoToPlanning(bloco) {
  const id = bloco._id || buildBlocoId(bloco);
  if (state.planningIds.has(id)) {
    alert('Esse bloco já está no seu planejamento.');
    return;
  }

  const plan = getPlanningList();
  const item = {
    ...bloco,
    _id: id,
    savedAt: new Date().toISOString(),
  };

  plan.push(item);
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  state.planningIds.add(id);
  renderPlanningList(plan);

  if (els.planningCatalog.children.length) {
    renderPlanningCatalog();
  }
}

function getPlanningList() {
  const raw = localStorage.getItem(PLAN_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function restorePlanning() {
  const plan = getPlanningList();
  state.planningIds = new Set(plan.map((item) => item._id));
  renderPlanningList(plan);
}

function clearPlanning() {
  localStorage.removeItem(PLAN_KEY);
  state.planningIds = new Set();
  renderPlanningList([]);
  els.planningCatalog.innerHTML = '';
  if (state.currentResults.length) {
    renderResults(state.currentResults, 'refresh');
  }
}

function renderPlanningList(list) {
  els.planningList.textContent = '';

  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'card';
    empty.textContent = 'Você ainda não salvou blocos no planejamento.';
    els.planningList.appendChild(empty);
    return;
  }

  list.forEach((bloco) => {
    const item = document.createElement('article');
    item.className = 'card';

    const title = document.createElement('h3');
    title.textContent = bloco.nome_bloco || 'Bloco sem nome';

    const time = document.createElement('p');
    const timeStrong = document.createElement('strong');
    timeStrong.textContent = '🕒 Concentração: ';
    time.appendChild(timeStrong);
    time.appendChild(document.createTextNode(`${bloco.data || '--'} ${bloco.hora_concentracao || '--'}`));

    const address = document.createElement('p');
    const addressStrong = document.createElement('strong');
    addressStrong.textContent = '📍 Endereço: ';
    address.appendChild(addressStrong);
    address.appendChild(
      document.createTextNode(
        `${bloco.endereco_concentracao || 'Não informado'} (${bloco.bairro || 'Bairro não informado'})`,
      ),
    );

    const metro = document.createElement('p');
    metro.textContent = bloco.metro || '🚇 Metrô: a calcular';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-small';
    removeBtn.textContent = 'Remover do planejamento';
    removeBtn.addEventListener('click', () => removeFromPlanning(bloco._id));

    item.appendChild(title);
    item.appendChild(time);
    item.appendChild(address);
    item.appendChild(metro);
    item.appendChild(removeBtn);
    els.planningList.appendChild(item);
  });
}

function removeFromPlanning(id) {
  const nextPlan = getPlanningList().filter((item) => item._id !== id);
  localStorage.setItem(PLAN_KEY, JSON.stringify(nextPlan));
  state.planningIds.delete(id);
  renderPlanningList(nextPlan);

  if (els.planningCatalog.children.length) {
    renderPlanningCatalog();
  }
  if (state.currentResults.length) {
    renderResults(state.currentResults, 'refresh');
  }
}

async function renderPlanningCatalog() {
  await ensureDataLoaded();
  const allBlocos = await enrichBlocosWithCoordinates(state.blocos);

  els.planningCatalog.textContent = '';

  if (!allBlocos.length) {
    const empty = document.createElement('p');
    empty.className = 'card';
    empty.textContent = 'Nenhum bloco encontrado na base.';
    els.planningCatalog.appendChild(empty);
    return;
  }

  allBlocos
    .map((bloco) => ({
      ...bloco,
      metro: findNearestMetro(bloco),
    }))
    .sort((a, b) => (toDate(a.data, a.hora_concentracao)?.getTime() || 0) - (toDate(b.data, b.hora_concentracao)?.getTime() || 0))
    .forEach((bloco) => {
      const card = document.createElement('article');
      card.className = 'card';

      const title = document.createElement('h3');
      title.textContent = bloco.nome_bloco || 'Bloco sem nome';

      const time = document.createElement('p');
      const timeStrong = document.createElement('strong');
      timeStrong.textContent = '🕒 Concentração: ';
      time.appendChild(timeStrong);
      time.appendChild(document.createTextNode(`${bloco.data || '--'} ${bloco.hora_concentracao || '--'}`));

      const address = document.createElement('p');
      const addressStrong = document.createElement('strong');
      addressStrong.textContent = '📍 Endereço: ';
      address.appendChild(addressStrong);
      address.appendChild(
        document.createTextNode(
          `${bloco.endereco_concentracao || 'Não informado'} (${bloco.bairro || 'Bairro não informado'})`,
        ),
      );

      const metro = document.createElement('p');
      metro.textContent = bloco.metro;

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-small planning-catalog-actions';

      if (state.planningIds.has(bloco._id)) {
        action.textContent = '✅ Já salvo no planejamento';
        action.disabled = true;
      } else {
        action.textContent = '💾 Salvar no planejamento';
        action.addEventListener('click', () => {
          addBlocoToPlanning(bloco);
          action.textContent = '✅ Já salvo no planejamento';
          action.disabled = true;
        });
      }

      card.appendChild(title);
      card.appendChild(time);
      card.appendChild(address);
      card.appendChild(metro);
      card.appendChild(action);
      els.planningCatalog.appendChild(card);
    });
}

async function shareSelectedBloco() {
  if (!state.selectedBloco) return;
  const bloco = state.selectedBloco;
  const metroLine = bloco.metro?.replace('🚇 Metrô mais próximo da concentração: ', '') || 'Indefinido';
  const text = `Vou para o bloco ${bloco.nome_bloco} 🎭\nLocal: ${bloco.endereco_concentracao}\nMetrô mais próximo: ${metroLine}`;

  await shareText(text, bloco.nome_bloco);
}

async function sharePlanningList() {
  const plan = getPlanningList();
  if (!plan.length) {
    alert('Seu planejamento está vazio.');
    return;
  }

  const organized = plan
    .slice()
    .sort((a, b) => (toDate(a.data, a.hora_concentracao)?.getTime() || 0) - (toDate(b.data, b.hora_concentracao)?.getTime() || 0))
    .map((bloco, index) => `${index + 1}. ${bloco.nome_bloco} - ${bloco.data || '--'} ${bloco.hora_concentracao || '--'} - ${bloco.endereco_concentracao || 'Sem endereço'}`)
    .join('\n');

  const text = `Meu planejamento de blocos 🎭\n\n${organized}`;
  await shareText(text, 'Planejamento de blocos');
}

async function shareText(text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ text, title });
      return;
    } catch (_) {
      // fallback below
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      alert('Planejamento copiado para a área de transferência.');
      return;
    } catch (_) {
      // continue fallback
    }
  }

  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(whatsappLink, '_blank', 'noopener');
}

function restoreGeocodeCache() {
  const raw = localStorage.getItem(GEO_CACHE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.geocodeCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    state.geocodeCache = {};
  }
}

function persistGeocodeCache() {
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(state.geocodeCache));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  let registrationRef = null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      registrationRef = await navigator.serviceWorker.register('service-worker.js', {
        updateViaCache: 'none',
      });

      registrationRef.update();

      setInterval(() => {
        registrationRef.update();
      }, 30 * 60 * 1000);
    } catch (_) {
      // ignore registration errors
    }
  });

  window.addEventListener('online', () => {
    if (registrationRef) {
      registrationRef.update();
    }
  });
}
