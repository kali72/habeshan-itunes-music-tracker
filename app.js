const SPREADSHEET_ID = "1PbFEMGn3XR3cnZXan04C65FdXPJbIVFAO_G51U9RGPU";
const API_KEY = "AIzaSyD4sLQaZ2Wld01E2wUzoPKfSVd39nOL_vA";

const CHARTS = [
  { containerId: "section-top-15-artists", anchorId: "top-15-artists", title: "Top 15 Artists", tabName: "Top 15 Artists" },
  { containerId: "section-all-time-tracks", anchorId: "all-time-tracks", title: "All-Time Most Heard", tabName: "All-Time Tracks" },
  { containerId: "section-weekly-top-10", anchorId: "weekly-top-10", title: "Weekly Top 10", tabName: "Weekly Top 10" },
  { containerId: "section-monthly-top-100", anchorId: "monthly-top-100", title: "Monthly Top 100", tabName: "Monthly Top 100" },
  { containerId: "section-three-month-top-100", anchorId: "three-month-top-100", title: "3-Month Top 100", tabName: "3-Month Top 100" },
  { containerId: "section-yearly-top-100", anchorId: "yearly-top-100", title: "Yearly Top 100", tabName: "Yearly Top 100" }
];

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initBackToTop();
  loadAllLeaderboards();
});

function initTheme() {
  const toggleBtn = document.getElementById("theme-toggle");
  if (!toggleBtn) return;

  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const currentTheme = savedTheme || (prefersDark ? "dark" : "light");

  document.documentElement.setAttribute("data-theme", currentTheme);
  updateToggleText(toggleBtn, currentTheme);

  toggleBtn.addEventListener("click", () => {
    const activeTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = activeTheme === "dark" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    updateToggleText(toggleBtn, newTheme);
  });
}

function updateToggleText(button, theme) {
  button.innerHTML = theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
}

async function loadAllLeaderboards() {
  CHARTS.forEach(chart => {
    const wrapper = document.getElementById(chart.containerId);
    if (wrapper) {
      wrapper.innerHTML = `
        <section id="${chart.anchorId}" class="ranking-section">
          <h2 class="section-title">${escapeHtml(chart.title)}</h2>
          <p style="color: var(--text-muted);">Loading chart...</p>
        </section>
      `;
    }
  });

  try {
    const fetchPromises = CHARTS.map(chart => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(chart.tabName)}'!A1:G101?key=${API_KEY}`;
      return fetch(url)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null);
    });

    const results = await Promise.all(fetchPromises);

    CHARTS.forEach((chart, index) => {
      const wrapper = document.getElementById(chart.containerId);
      if (!wrapper) return;

      const data = results[index];
      const rows = data ? data.values : null;

      let sectionContent = `<h2 class="section-title">${escapeHtml(chart.title)}</h2>`;

      if (rows && rows.length > 1) {
        sectionContent += generateTableHtml(rows, chart.tabName);
      } else {
        sectionContent += `<p style="color: var(--text-muted);">No data currently available.</p>`;
      }

      wrapper.innerHTML = `
        <section id="${chart.anchorId}" class="ranking-section">
          ${sectionContent}
        </section>
      `;
    });
  } catch (error) {
    console.error("Fetch error:", error);
  }
}

// Builds a URL-safe slug from a track title for the Apple Music link.
// Apple ignores this segment for routing (only the trailing numeric ID
// matters), but the link 404s/misbehaves without a "/song/{slug}/{id}"
// shape -- "/album/{id}" (the old code) is the wrong path entirely.
function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "track";
}

function generateTableHtml(rows, tabName) {
  const dataRows = rows.slice(1);
  const isArtistTable = tabName === "Top 15 Artists";

  let tableHtml = `
    <div class="table-container">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Cover</th>
            ${isArtistTable ? `<th>Artist</th><th>Bio</th>` : `<th>Title</th><th>Artist</th>`}
          </tr>
        </thead>
        <tbody>
  `;

  dataRows.forEach((row) => {
    const rank = row[0] || "";
    const coverUrl = row[1] || "";
    const col3 = row[2] || "";
    const col4 = row[3] || "";
    const trackId = row[4] || "";

    // Apple Music web links are shaped /{storefront}/song/{slug}/{trackId};
    // the slug is cosmetic (Apple derives it from the track title) but the
    // path segment ("song", not "album") and the extra slug are required
    // for the link to resolve correctly.
    const itunesUrl = trackId && !isArtistTable
      ? `https://music.apple.com/us/song/${slugify(col4)}/${escapeHtml(trackId)}`
      : "#";

    const fallbackImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='%23888'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";
    const imgSrc = coverUrl ? escapeHtml(coverUrl) : fallbackImg;

    if (isArtistTable) {
      tableHtml += `
        <tr>
          <td><span class="rank-badge rank-${escapeHtml(rank)}">${escapeHtml(rank)}</span></td>
          <td>
            <img src="${imgSrc}" 
                 onerror="this.onerror=null;this.src='${fallbackImg}';" 
                 alt="${escapeHtml(col3)}" 
                 class="track-cover artist-avatar" 
                 loading="lazy" />
          </td>
          <td class="track-title-cell"><strong>${escapeHtml(col3)}</strong></td>
          <td class="track-artist artist-bio">${escapeHtml(col4)}</td>
        </tr>
      `;
    } else {
      tableHtml += `
        <tr class="clickable-row" onclick="window.open('${itunesUrl}', '_blank')" title="Listen on Apple Music">
          <td><span class="rank-badge rank-${escapeHtml(rank)}">${escapeHtml(rank)}</span></td>
          <td>
            <img src="${imgSrc}" 
                 onerror="this.onerror=null;this.src='${fallbackImg}';" 
                 alt="Track Cover" 
                 class="track-cover" 
                 loading="lazy" />
          </td>
          <td class="track-title-cell">
            <a href="${itunesUrl}" target="_blank" rel="noopener noreferrer" class="track-link" onclick="event.stopPropagation()">
              ${escapeHtml(col4)}
            </a>
          </td>
          <td class="track-artist">${escapeHtml(col3)}</td>
        </tr>
      `;
    }
  });

  tableHtml += `</tbody></table></div>`;
  return tableHtml;
}
function initBackToTop() {
  const backToTopBtn = document.getElementById("back-to-top");
  if (!backToTopBtn) return;

  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) {
      backToTopBtn.classList.add("show");
    } else {
      backToTopBtn.classList.remove("show");
    }
  });

  backToTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
