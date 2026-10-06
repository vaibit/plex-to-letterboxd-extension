const logDiv = document.getElementById('log');
const librariesDiv = document.getElementById('libraries');
const exportButton = document.getElementById('exportButton');
const watchedOnly = document.getElementById('watchedOnly');
const diaryFields = document.getElementById('diaryFields');

let servers = [];

function addLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = message;
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// Runs plexBridge inside the active tab, so requests go out with the tab's
// origin and Plex Web's stored token, and no host permissions are needed.
async function runInTab(action, args = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: plexBridge,
      args: [action, args],
    });
  } catch (error) {
    throw new Error('Open Plex Web in this tab first (your server\'s /web page or app.plex.tv).');
  }
  const result = results?.[0]?.result;
  if (!result) throw new Error('No response from the page.');
  if (result.error) throw new Error(result.error);
  return result.data;
}

function renderLibraries() {
  librariesDiv.textContent = '';
  servers.forEach((server, serverIndex) => {
    const heading = document.createElement('div');
    heading.className = 'server';
    heading.textContent = server.name;
    librariesDiv.appendChild(heading);

    if (server.error) {
      const note = document.createElement('div');
      note.className = 'warning';
      note.textContent = server.error;
      librariesDiv.appendChild(note);
      return;
    }

    server.libraries.forEach((library, libraryIndex) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkbox.dataset.server = serverIndex;
      checkbox.dataset.library = libraryIndex;
      label.append(checkbox, ` ${library.title} (${library.count} films)`);
      librariesDiv.appendChild(label);
    });
  });
}

function plexIds(movie) {
  const ids = {};
  for (const id of [...movie.guids, movie.guid || '']) {
    // New agents: imdb://tt0133093, tmdb://603
    // Legacy agents: com.plexapp.agents.imdb://tt0133093?lang=en, com.plexapp.agents.themoviedb://603?lang=en
    const match = id.match(/(?:^|\.)(imdb|tmdb|themoviedb):\/\/([^?]+)/);
    if (!match) continue;
    const kind = match[1] === 'imdb' ? 'imdb' : 'tmdb';
    ids[kind] ??= match[2];
  }
  return ids;
}

function localDate(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function csvField(value) {
  if (value === undefined || value === null || value === '') return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildCsv(movies, includeDiary) {
  const header = ['Title', 'Year', 'imdbID', 'tmdbID'];
  if (includeDiary) header.push('WatchedDate', 'Rating10');

  const rows = movies.map((movie) => {
    const ids = plexIds(movie);
    const row = [movie.title, movie.year, ids.imdb, ids.tmdb];
    if (includeDiary) {
      const rating = movie.userRating ? Math.min(10, Math.max(1, Math.round(movie.userRating))) : '';
      row.push(movie.lastViewedAt ? localDate(movie.lastViewedAt) : '', rating);
    }
    return row.map(csvField).join(',');
  });

  return '﻿' + [header.join(','), ...rows].join('\n');
}

function download(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportSelected() {
  const selected = [...librariesDiv.querySelectorAll('input:checked')].map((checkbox) => ({
    server: servers[checkbox.dataset.server],
    library: servers[checkbox.dataset.server].libraries[checkbox.dataset.library],
  }));
  if (selected.length === 0) {
    addLogEntry('Select at least one library.', 'warning');
    return;
  }

  exportButton.disabled = true;
  try {
    const byKey = new Map();
    for (const { server, library } of selected) {
      addLogEntry(`Fetching ${library.title}…`);
      const movies = await runInTab('movies', { baseUrl: server.baseUrl, token: server.token, key: library.key });
      for (const movie of movies) {
        const ids = plexIds(movie);
        const key = ids.imdb || ids.tmdb || `${movie.title}|${movie.year}`;
        if (!byKey.has(key)) byKey.set(key, movie);
      }
      addLogEntry(`${library.title}: ${movies.length} films`);
    }

    let movies = [...byKey.values()];
    if (watchedOnly.checked) movies = movies.filter((movie) => movie.viewCount > 0 || movie.lastViewedAt);
    movies.sort((a, b) => a.title.localeCompare(b.title) || (a.year || 0) - (b.year || 0));

    const missingIds = movies.filter((movie) => !plexIds(movie).imdb && !plexIds(movie).tmdb).length;
    if (missingIds) addLogEntry(`${missingIds} films have no IMDb/TMDB ID and will be matched by title + year.`, 'warning');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `plex_movies_${movies.length}_${timestamp}.csv`;
    download(buildCsv(movies, diaryFields.checked), filename);
    addLogEntry(`Exported ${movies.length} films to ${filename}`, 'success');
  } catch (error) {
    addLogEntry(`Error: ${error.message}`, 'warning');
  } finally {
    exportButton.disabled = false;
  }
}

async function init() {
  addLogEntry('Looking for Plex servers…');
  try {
    servers = await runInTab('libraries');
    for (const server of servers) {
      if (server.error) addLogEntry(`${server.name}: ${server.error}`, 'warning');
    }
    const libraryCount = servers.reduce((sum, server) => sum + (server.libraries?.length || 0), 0);
    if (libraryCount === 0) {
      addLogEntry('No movie libraries found.', 'warning');
    } else {
      addLogEntry(`Found ${libraryCount} movie ${libraryCount === 1 ? 'library' : 'libraries'}.`, 'success');
      exportButton.disabled = false;
    }
    renderLibraries();
  } catch (error) {
    addLogEntry(error.message, 'warning');
  }
}

exportButton.addEventListener('click', exportSelected);
init();

// Injected into the Plex Web tab. Must be self-contained: it's serialized and
// runs in the page, with no access to anything else in this file.
async function plexBridge(action, args) {
  const PAGE_SIZE = 500;

  function readToken() {
    try {
      const token = localStorage.getItem('myPlexAccessToken');
      if (token) return token;
      const users = JSON.parse(localStorage.getItem('users') || 'null');
      const list = Array.isArray(users) ? users : users?.users;
      return list?.[0]?.authToken || null;
    } catch {
      return null;
    }
  }

  async function getJson(url, token, { timeout = 15000, headers = {} } = {}) {
    const allHeaders = { Accept: 'application/json', ...headers };
    if (token) allHeaders['X-Plex-Token'] = token;
    const response = await fetch(url, { headers: allHeaders, signal: AbortSignal.timeout(timeout) });
    if (response.status === 401) throw new Error('Not authorized. Sign in to Plex in this tab.');
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${new URL(url).host}`);
    return response.json();
  }

  async function findServers() {
    const token = readToken();

    // Plex Web served by the server itself (http://127.0.0.1:32400/web, a reverse proxy, …)
    if (location.hostname !== 'app.plex.tv') {
      try {
        await getJson(`${location.origin}/identity`, null, { timeout: 5000 });
      } catch {
        throw new Error('This tab is not Plex Web. Open your server\'s /web page or app.plex.tv.');
      }
      return [{ name: location.host, baseUrl: location.origin, token }];
    }

    // app.plex.tv: ask plex.tv for the account's servers, then find a reachable connection.
    if (!token) throw new Error('Sign in to Plex in this tab first.');
    const resources = await getJson('https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', token, {
      headers: {
        'X-Plex-Client-Identifier': localStorage.getItem('clientID') || 'plex-to-letterboxd',
        'X-Plex-Product': 'Plex to Letterboxd',
      },
    });
    const serverResources = resources.filter((resource) => (resource.provides || '').split(',').includes('server'));

    return Promise.all(serverResources.map(async (resource) => {
      const serverToken = resource.accessToken || token;
      const connections = (resource.connections || []).filter((connection) => connection.protocol === 'https');
      try {
        const baseUrl = await Promise.any(connections.map(async (connection) => {
          await getJson(`${connection.uri}/identity`, null, { timeout: 4000 });
          return connection.uri;
        }));
        return { name: resource.name, baseUrl, token: serverToken };
      } catch {
        return { name: resource.name, error: 'Server is not reachable from this browser.' };
      }
    }));
  }

  async function libraries() {
    const found = await findServers();
    return Promise.all(found.map(async (server) => {
      if (server.error) return server;
      try {
        const data = await getJson(`${server.baseUrl}/library/sections`, server.token);
        const sections = (data.MediaContainer.Directory || []).filter((section) => section.type === 'movie');
        server.libraries = await Promise.all(sections.map(async (section) => {
          // Container size 0 returns just the total count.
          const counted = await getJson(
            `${server.baseUrl}/library/sections/${section.key}/all?type=1&X-Plex-Container-Start=0&X-Plex-Container-Size=0`,
            server.token,
          );
          return { key: section.key, title: section.title, count: counted.MediaContainer.totalSize ?? counted.MediaContainer.size };
        }));
      } catch (error) {
        server.error = error.message;
      }
      return server;
    }));
  }

  async function movies({ baseUrl, token, key }) {
    const items = [];
    for (let start = 0; ; start += PAGE_SIZE) {
      const data = await getJson(
        `${baseUrl}/library/sections/${key}/all?type=1&includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE_SIZE}`,
        token,
        { timeout: 60000 },
      );
      const batch = data.MediaContainer.Metadata || [];
      for (const item of batch) {
        items.push({
          title: item.title,
          year: item.year,
          guid: item.guid,
          guids: (item.Guid || []).map((guid) => guid.id),
          viewCount: item.viewCount || 0,
          lastViewedAt: item.lastViewedAt,
          userRating: item.userRating,
        });
      }
      if (batch.length < PAGE_SIZE) break;
    }
    return items;
  }

  try {
    if (action === 'libraries') return { data: await libraries() };
    if (action === 'movies') return { data: await movies(args) };
    return { error: `Unknown action: ${action}` };
  } catch (error) {
    return { error: error.message };
  }
}
