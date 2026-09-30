// Configuration & State
const GOOGLE_SHEETS_ENDPOINT = "https://script.google.com/macros/s/AKfycbyWqRfkB66ePyyuKe3iBpsVA3LGuV70QSFMIn3RoUXH8Iq7QC5F5U1ZUWdPIHYiXxSh/exec"; // Replace with your Web App Exec URL

let currentFilter = "all-time";
let currentLimit = 48;
let currentlyPlayingBtn = null;
let currentTrackList = [];

// DOM Elements
const audioPlayer = document.getElementById('audio-player');
const musicGrid = document.getElementById('music-grid');
const loader = document.getElementById('loader');
const sectionTitle = document.getElementById('section-title');
const sectionSubtitle = document.getElementById('section-subtitle');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const itunesLiveBtn = document.getElementById('itunes-live-btn');

// --- 1. GOOGLE SHEETS TAB FETCHING ---
async function fetchSheetRankings(timeframe) {
  try {
    const response = await fetch(`${GOOGLE_SHEETS_ENDPOINT}?timeframe=${timeframe}`);
    const sheetData = await response.json();
    return sheetData || [];
  } catch (error) {
    console.error('Error fetching Google Sheets data:', error);
    return [];
  }
}

// Fetch iTunes details for a list of track IDs
async function fetchiTunesDetailsByIds(trackIds) {
  if (!trackIds || trackIds.length === 0) return [];
  
  // Clean IDs and join into comma-separated list
  const validIds = trackIds.filter(id => id).join(',');
  if (!validIds) return [];

  const url = `https://itunes.apple.com/lookup?id=${validIds}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('Error fetching iTunes lookup details:', error);
    return [];
  }
}

// Filter Navigation Handler
async function loadFilterData(filterType) {
  currentFilter = filterType;
  showLoader(true);
  
  let tracks = [];
  const tabTitles = {
    'all-time': 'All-Time Tracks',
    'weekly': 'Weekly Top 10',
    'monthly': 'Monthly Top 100',
    'quarterly': '3-Month Top 100',
    'yearly': 'Yearly Top 100',
    'top-15-artists': 'Top 15 Artists'
  };

  sectionTitle.querySelector('span').textContent = tabTitles[filterType] || 'Tracks';
  sectionSubtitle.textContent = 'Sourced directly from your Habesha iTunes Google Sheet';

  // Fetch row items from selected Google Sheet tab
  const rawSheetRows = await fetchSheetRankings(filterType);
  
  if (rawSheetRows.length > 0) {
    const trackIds = rawSheetRows.map(row => row.trackId || row['Track ID']).filter(id => id);
    if (trackIds.length > 0) {
      tracks = await fetchiTunesDetailsByIds(trackIds);
    }
  }

  // Fallback: If no tracks loaded from sheet, fetch live search fallback
  if (!tracks || tracks.length === 0) {
    tracks = await fetchLiveiTunesSearch("Ethiopian Music", 24);
  }

  currentTrackList = tracks;
  showLoader(false);
  renderMusicCards(currentTrackList.slice(0, currentLimit));
}

// --- 2. LIVE SEARCH BAR FUNCTIONALITY ---
async function fetchLiveiTunesSearch(query, limit = 24) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('iTunes Search API Error:', error);
    return [];
  }
}

// Handle Search Form Submission
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  showLoader(true);
  sectionTitle.querySelector('span').textContent = `Search Results: "${query}"`;
  sectionSubtitle.textContent = 'Live search directly from iTunes Store API';

  // Clear active state on header pills
  document.querySelectorAll('.pill-btn').forEach(b => {
    b.className = "pill-btn px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition";
  });

  const searchResults = await fetchLiveiTunesSearch(query, 48);
  currentTrackList = searchResults;
  
  showLoader(false);
  renderMusicCards(currentTrackList.slice(0, currentLimit));
});

// --- 3. ITUNES LIVE BUTTON FUNCTIONALITY ---
itunesLiveBtn.addEventListener('click', async () => {
  showLoader(true);
  sectionTitle.querySelector('span').textContent = "iTunes Live: Hot Ethiopian Tracks";
  sectionSubtitle.textContent = "Fetching live trending Ethiopian music directly from iTunes Store";

  // Clear active tab styles
  document.querySelectorAll('.pill-btn').forEach(b => {
    b.className = "pill-btn px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition";
  });

  // Fetch fresh live hits directly from iTunes
  const liveTracks = await fetchLiveiTunesSearch("Ethiopian New", 48);
  currentTrackList = liveTracks;

  showLoader(false);
  renderMusicCards(currentTrackList.slice(0, currentLimit));
});

// --- CARD RENDERING & AUDIO PLAYER ---
function renderMusicCards(tracks) {
  musicGrid.innerHTML = '';

  if (!tracks || tracks.length === 0) {
    musicGrid.innerHTML = `<p class="col-span-full text-center text-gray-400 py-10">No tracks found. Try selecting another tab or search query!</p>`;
    return;
  }

  tracks.forEach((track, index) => {
    const artwork = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '300x300bb') : 'https://via.placeholder.com/300';
    const releaseYear = track.releaseDate ? new Date(track.releaseDate).getFullYear() : 'N/A';

    const card = document.createElement('div');
    card.className = "group relative bg-cardBg rounded-xl overflow-hidden border border-gray-800/80 hover:border-gray-700 transition-all duration-300";
    
    card.innerHTML = `
      <div class="relative aspect-[1/1] overflow-hidden bg-gray-900">
        <span class="absolute top-2 left-2 z-10 bg-black/70 backdrop-blur-md text-brand font-black text-xs px-2 py-0.5 rounded border border-brand/30">
          #${index + 1}
        </span>
        <img src="${artwork}" alt="${track.trackName}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3">
          <div class="flex justify-end">
            <a href="${track.trackViewUrl}" target="_blank" title="View on iTunes" class="p-2 bg-black/60 hover:bg-brand hover:text-black rounded-full text-white transition">
              <i class="fa-brands fa-apple text-sm"></i>
            </a>
          </div>
          <div class="flex justify-center">
            <button data-preview="${track.previewUrl}" class="play-btn p-3 bg-brand text-black rounded-full shadow-lg hover:scale-110 transition transform">
              <i class="fa-solid fa-play text-lg translate-x-0.5"></i>
            </button>
          </div>
          <div class="text-right">
            <span class="text-[10px] bg-black/70 px-2 py-1 rounded text-gray-300 font-medium">
              ${track.primaryGenreName || 'Habesha'}
            </span>
          </div>
        </div>
      </div>
      <div class="p-3">
        <h3 class="text-sm font-semibold truncate text-gray-100 group-hover:text-brand transition-colors" title="${track.trackName}">
          ${track.trackName}
        </h3>
        <p class="text-xs text-gray-400 mt-0.5 truncate">${track.artistName}</p>
        <p class="text-[11px] text-gray-500 mt-1 flex items-center justify-between">
          <span>${releaseYear}</span>
          <span class="text-brand font-medium">${track.trackPrice > 0 ? '$' + track.trackPrice : 'iTunes'}</span>
        </p>
      </div>
    `;

    musicGrid.appendChild(card);
  });

  attachPlayListeners();
}

// Attach Event Listeners to Audio Play Buttons
function attachPlayListeners() {
  document.querySelectorAll('.play-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const previewUrl = btn.getAttribute('data-preview');
      const icon = btn.querySelector('i');

      if (!previewUrl) return;

      if (audioPlayer.src === previewUrl && !audioPlayer.paused) {
        audioPlayer.pause();
        icon.className = 'fa-solid fa-play text-lg translate-x-0.5';
      } else {
        if (currentlyPlayingBtn) {
          currentlyPlayingBtn.querySelector('i').className = 'fa-solid fa-play text-lg translate-x-0.5';
        }
        audioPlayer.src = previewUrl;
        audioPlayer.play();
        icon.className = 'fa-solid fa-pause text-lg';
        currentlyPlayingBtn = btn;
      }
    });
  });
}

// Category Pills Tab Click Handler
document.querySelectorAll('.pill-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-btn').forEach(b => {
      b.className = "pill-btn px-3 py-1.5 rounded-full text-gray-400 hover:text-white transition";
    });
    btn.className = "pill-btn active px-3 py-1.5 rounded-full bg-brand text-black font-semibold shadow-sm transition";

    const targetTab = btn.getAttribute('data-tab');
    loadFilterData(targetTab);
  });
});

// Limit Display Count Buttons Handler
document.querySelectorAll('.limit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.limit-btn').forEach(b => {
      b.className = "limit-btn px-3 py-1 text-gray-400 hover:text-white";
    });
    btn.className = "limit-btn active px-3 py-1 bg-gray-800 text-white rounded-md";

    currentLimit = parseInt(btn.getAttribute('data-limit'));
    renderMusicCards(currentTrackList.slice(0, currentLimit));
  });
});

// Helpers
function showLoader(visible) {
  if (visible) {
    loader.classList.remove('hidden');
    musicGrid.innerHTML = '';
  } else {
    loader.classList.add('hidden');
  }
}

// Reset play icon when audio finishes playing
audioPlayer.addEventListener('ended', () => {
  if (currentlyPlayingBtn) {
    currentlyPlayingBtn.querySelector('i').className = 'fa-solid fa-play text-lg translate-x-0.5';
  }
});

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  loadFilterData('all-time');
});
