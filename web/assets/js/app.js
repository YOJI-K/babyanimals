const Site = {
  mountShell(){
    const header = document.createElement('header');
    header.className='header';
    header.innerHTML=`<div class="container nav">
      <a class="logo" href="/">🐣 Baby Animals</a>
      <nav class="links">
        <a href="/news/">ニュース</a>
        <a href="/babies/">赤ちゃん一覧</a>
        <a href="/calendar/">カレンダー</a>
      </nav>
    </div>`;
    document.body.prepend(header);

    const footer = document.createElement('footer');
    const y = new Date().getFullYear();
    footer.innerHTML=`<div class="container flex">
      <div class="small">© ${y} Baby Animals</div>
      <div class="small"><a href="#">プライバシー</a>・<a href="#">免責事項</a></div>
    </div>`;
    document.body.append(footer);
  },
  fmtDate(iso){
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  },
  domain(u){ try{ return new URL(u).host.replace(/^www\./,''); }catch{ return ''; } }
};
document.addEventListener('DOMContentLoaded', Site.mountShell);
