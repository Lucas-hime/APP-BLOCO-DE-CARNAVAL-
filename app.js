const LOCATION_KEY = 'blocosrj.location';
const WEATHER_KEY = 'blocosrj.weather';
const RESULTS_KEY = 'blocosrj.results';

const state = {
  userLocation: null,
  blocos: null,
  metroStations: [],
  selectedBloco: null,
};

const els = {
  locationStatus: document.getElementById('location-status'),
  locationCoords: document.getElementById('location-coords'),
  changeLocation: document.getElementById('change-location'),
  retryLocation: document.getElementById('retry-location'),
  modal: document.getElementById('location-modal'),
  manualForm: document.getElementById('manual-location-form'),
  manualInput: document.getElementById('manual-location-input'),
  weatherContent: document.getElementById('weather-content'),
  refreshWeather: document.getElementById('refresh-weather'),
  nearbyBtn: document.getElementById('nearby-btn'),
  nextHoursBtn: document.getElementById('next-hours-btn'),
  clearResults: document.getElementById('clear-results'),
  results: document.getElementById('results'),
  cardTemplate: document.getElementById('bloco-card-template'),
  selectionSection: document.getElementById('selection-section'),
  selectedTitle: document.getElementById('selected-title'),
  confirmBloco: document.getElementById('confirm-bloco'),
  shareBloco: document.getElementById('share-bloco'),
};

init();

function init() {
  registerServiceWorker();
  bindEvents();
  restoreCachedWeather();
  restoreCachedResults();
  detectLocation();
}

function bindEvents() {
  els.changeLocation.addEventListener('click', () => els.modal.showModal());
  els.retryLocation.addEventListener('click', detectLocation);
  els.refreshWeather.addEventListener('click', fetchWeather);
  els.nearbyBtn.addEventListener('click', findNearbyBlocos);
  els.nextHoursBtn.addEventListener('click', findNextHoursBlocos);
  els.clearResults.addEventListener('click', clearResults);
  els.confirmBloco.addEventListener('click', () => {
    if (!state.selectedBloco) return;
    alert(`Boa! Te esperamos em ${state.selectedBloco.nome_bloco} 🎉`);
  });
  els.shareBloco.addEventListener('click', shareSelectedBloco);

  els.manualForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (els.manualForm.returnValue === 'cancel') {
      els.modal.close();
      return;
    }
    const query = els.manualInput.value.trim();
    if (!query) return;
    await setManualLocation(query);
    els.modal.close();
    els.manualForm.reset();
  });
}

function detectLocation() {
  els.locationStatus.textContent = 'Detectando localização...';
  if (!navigator.geolocation) {
    setLocationUnavailable('Localização não disponível (geolocalização indisponível).');
    useSavedLocation();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      setUserLocation(latitude, longitude, 'GPS');
      els.locationStatus.textContent = 'Localização detectada com sucesso';
      fetchWeather();
    },
    () => {
      setLocationUnavailable('Localização não disponível');
      useSavedLocation();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
  );
}

function useSavedLocation() {
  const saved = localStorage.getItem(LOCATION_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    if (parsed?.latitude && parsed?.longitude) {
      setUserLocation(parsed.latitude, parsed.longitude, parsed.source || 'salva');
      els.locationStatus.textContent = 'Localização carregada do armazenamento';
      fetchWeather();
    }
  } catch (_) {
    // ignore
  }
}

async function setManualLocation(query) {
  els.locationStatus.textContent = 'Buscando localização manual...';
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    const data = await response.json();
    if (!data.length) {
      setLocationUnavailable('Localização não encontrada para esse endereço.');
      return;
    }

    const { lat, lon } = data[0];
    setUserLocation(Number(lat), Number(lon), `manual: ${query}`);
    els.locationStatus.textContent = 'Localização detectada com sucesso';
    fetchWeather();
  } catch (error) {
    setLocationUnavailable('Falha ao buscar localização manual.');
  }
}

function setUserLocation(latitude, longitude, source) {
  state.userLocation = { latitude, longitude, source };
  localStorage.setItem(LOCATION_KEY, JSON.stringify(state.userLocation));
  els.locationCoords.textContent = `Lat ${latitude.toFixed(5)} • Lng ${longitude.toFixed(5)} (${source})`;
  els.refreshWeather.disabled = false;
}

function setLocationUnavailable(message) {
  els.locationStatus.textContent = message;
  els.locationCoords.textContent = '';
  els.refreshWeather.disabled = true;
}

async function fetchWeather() {
  if (!state.userLocation) return;
  const { latitude, longitude } = state.userLocation;
  const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature&hourly=precipitation_probability&timezone=auto&forecast_days=1`;

  try {
    const response = await fetch(weatherURL);
    const data = await response.json();
    const weather = {
      temp: data.current.temperature_2m,
      apparent: data.current.apparent_temperature,
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
    const weather = JSON.parse(cached);
    renderWeather(weather, fromError);
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
  if (!state.blocos) {
    const csvResponse = await fetch('blocos.csv');
    const csvText = await csvResponse.text();
    state.blocos = parseCSV(csvText);
  }
  if (!state.metroStations.length) {
    const metroResponse = await fetch('metro_stations.json');
    state.metroStations = await metroResponse.json();
  }
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map((line) => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx] ?? '';
    });
    obj.latitude = obj.latitude ? Number(obj.latitude) : null;
    obj.longitude = obj.longitude ? Number(obj.longitude) : null;
    return obj;
  });
}

async function findNearbyBlocos() {
  if (!state.userLocation) {
    alert('Ative ou informe sua localização antes de buscar blocos.');
    return;
  }
  await ensureDataLoaded();
  const matches = state.blocos
    .filter((bloco) => bloco.latitude && bloco.longitude)
    .map((bloco) => {
      const distance = haversine(state.userLocation.latitude, state.userLocation.longitude, bloco.latitude, bloco.longitude);
      return {
        ...bloco,
        distance,
        metro: findNearestMetro(bloco),
      };
    })
    .filter((bloco) => bloco.distance <= 5)
    .sort((a, b) => a.distance - b.distance);

  renderResults(matches, 'nearby');
}

async function findNextHoursBlocos() {
  await ensureDataLoaded();
  const now = new Date();
  const limit = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  const matches = state.blocos
    .filter((bloco) => isInNextHours(bloco.data, bloco.hora_concentracao, now, limit))
    .map((bloco) => ({
      ...bloco,
      distance: bloco.latitude && bloco.longitude && state.userLocation
        ? haversine(state.userLocation.latitude, state.userLocation.longitude, bloco.latitude, bloco.longitude)
        : null,
      metro: findNearestMetro(bloco),
    }))
    .sort((a, b) => toDate(a.data, a.hora_concentracao) - toDate(b.data, b.hora_concentracao));

  renderResults(matches, 'next3h');
}

function isInNextHours(dateText, hourText, start, end) {
  const blocoDate = toDate(dateText, hourText);
  if (!blocoDate) return false;
  return blocoDate >= start && blocoDate <= end;
}

function toDate(dateText, hourText) {
  if (!dateText || !hourText) return null;
  const [day, month, year] = dateText.split('/').map(Number);
  const [hour, minute] = hourText.split(':').map(Number);
  if ([day, month, year, hour, minute].some(Number.isNaN)) return null;
  return new Date(year, month - 1, day, hour, minute);
}

function findNearestMetro(bloco) {
  if (!bloco.latitude || !bloco.longitude) {
    return '🚇 Metrô: coordenadas do bloco ausentes';
  }
  let nearest = null;
  for (const station of state.metroStations) {
    const d = haversine(bloco.latitude, bloco.longitude, station.latitude, station.longitude);
    if (!nearest || d < nearest.distance) {
      nearest = { name: station.name, distance: d };
    }
  }
  return `🚇 Descer no metrô: ${nearest?.name ?? 'Indefinido'}`;
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

function renderResults(list, mode) {
  els.results.innerHTML = '';
  if (!list.length) {
    els.results.innerHTML = '<p class="card">Nenhum bloco encontrado para este filtro.</p>';
    return;
  }

  list.forEach((bloco) => {
    const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.bloco-name').textContent = bloco.nome_bloco;
    node.querySelector('.bloco-distance').textContent = bloco.distance != null
      ? `📏 Distância: ${bloco.distance.toFixed(2)} km`
      : '📏 Distância: indisponível sem localização';
    node.querySelector('.bloco-time').textContent = `${bloco.data} ${bloco.hora_concentracao}`;
    node.querySelector('.bloco-address').textContent = `${bloco.endereco_concentracao} (${bloco.bairro})`;
    node.querySelector('.bloco-metro').textContent = bloco.metro;
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

async function shareSelectedBloco() {
  if (!state.selectedBloco) return;
  const bloco = state.selectedBloco;
  const metroLine = bloco.metro?.replace('🚇 ', '') || 'Indefinido';
  const text = `Vou para o bloco ${bloco.nome_bloco} 🎭\nLocal: ${bloco.endereco_concentracao}\nMetrô mais próximo: ${metroLine}`;

  if (navigator.share) {
    try {
      await navigator.share({ text, title: bloco.nome_bloco });
      return;
    } catch (_) {
      // fallback below
    }
  }

  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(whatsappLink, '_blank', 'noopener');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {
        // ignore registration errors
      });
    });
  }
}
