const teams = [
  'ANA','BOS','BUF','CAR','CBJ','CGY','CHI','COL','DAL','DET','EDM','FLA','LAK','MIN','MTL','NJD','NSH','NYI','NYR','OTT','PHI','PIT','SEA','SJS','STL','TBL','TOR','UTA','VAN','VGK','WPG','WSH'
];

const away = document.getElementById('awayTeam');
const home = document.getElementById('homeTeam');
const date = document.getElementById('gameDate');
const status = document.getElementById('status');
const briefingEl = document.getElementById('briefing');
const gfxEl = document.getElementById('gfx');

function fillTeams(select) {
  select.innerHTML = teams.map((t) => `<option value="${t}">${t}</option>`).join('');
}

function renderSection(title, items = []) {
  return `
    <section>
      <h3>${title}</h3>
      <ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>
    </section>
  `;
}

function setStatus(msg) { status.textContent = msg; }

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function generate() {
  if (!away.value || !home.value || !date.value) {
    setStatus('Select away team, home team, and game date.');
    return;
  }

  setStatus('Finding official game notes file...');

  try {
    const payload = { awayTeam: away.value, homeTeam: home.value, gameDate: date.value };
    const fileInfo = await post('/api/find-game-note', payload);
    setStatus(`Found ${fileInfo.filename}. Generating with AI...`);

    const result = await post('/api/generate', payload);
    const b = result.producerBriefing;
    const g = result.gfxList;

    briefingEl.innerHTML = [
      `<p><strong>Source:</strong> <a href="${result.sourcePdfUrl}" target="_blank">${result.sourcePdfFile}</a></p>`,
      renderSection('SITUATION OVERVIEW', b.situationOverview),
      renderSection('TIER 1 — Must-use storylines', b.tier1MustUse),
      renderSection('TIER 2 — Supporting storylines', b.tier2Supporting),
      renderSection('TIER 3 — Depth/fill', b.tier3DepthFill),
      renderSection('CONTINGENCY — If a key player is unavailable', b.contingencyIfUnavailable),
      renderSection('QUICK REFERENCE STATS', b.quickReferenceStats),
    ].join('');

    gfxEl.innerHTML = [
      `<p><strong>Source:</strong> <a href="${result.sourcePdfUrl}" target="_blank">${result.sourcePdfFile}</a></p>`,
      renderSection('LOWER THIRDS — NBC Sports style', g.lowerThirds),
      renderSection('FULL SCREENS', g.fullScreens),
    ].join('');

    setStatus('Complete. Review tabs and print the GFX tab as needed.');
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
}

fillTeams(away);
fillTeams(home);

document.getElementById('generateBtn').addEventListener('click', generate);
document.getElementById('printBtn').addEventListener('click', () => {
  document.querySelector('[data-tab="gfx"]').click();
  window.print();
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.output').forEach((o) => o.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});
