let page = 1;
const PAGE_SIZE = 12;
let all = [];

async function loadMock(){
  const res = await fetch('/assets/mock/news.json');
  return res.json();
}

function render(){
  const q = (document.getElementById('q').value||'').toLowerCase();
  const source = document.getElementById('source').value;
  const sort = document.getElementById('sort').value;

  let data = [...all];
  if (q) data = data.filter(x => (x.title||'').toLowerCase().includes(q) || (x.source_name||'').toLowerCase().includes(q));
  if (source === 'YouTube') data = data.filter(x => x.source_name === 'YouTube');
  if (source === 'blog') data = data.filter(x => x.source_name !== 'YouTube');

  data.sort((a,b)=> sort==='desc' ? (new Date(b.published_at)-new Date(a.published_at)) : (new Date(a.published_at)-new Date(b.published_at)));

  const start = 0;
  const end = page * PAGE_SIZE;
  const slice = data.slice(start, end);

  const el = document.getElementById('list');
  el.innerHTML = slice.map(x => `
    <a class="card" href="${x.url}" target="_blank" rel="noopener">
      <img class="thumb" src="${x.thumbnail_url || ''}" alt="">
      <div class="pad">
        <h3>${x.title || '(no title)'}</h3>
        <div class="meta">${Site.fmtDate(x.published_at)} ・ ${Site.domain(x.url)}</div>
        <div class="badge">${x.source_name || ''}</div>
      </div>
    </a>
  `).join('');

  document.getElementById('empty').style.display = slice.length ? 'none' : 'block';
}

document.addEventListener('DOMContentLoaded', async () => {
  all = await loadMock();
  render();

  document.getElementById('q').addEventListener('input', ()=>{ page=1; render(); });
  document.getElementById('source').addEventListener('change', ()=>{ page=1; render(); });
  document.getElementById('sort').addEventListener('change', ()=>{ page=1; render(); });
  document.getElementById('more').addEventListener('click', ()=>{ page++; render(); });
});
