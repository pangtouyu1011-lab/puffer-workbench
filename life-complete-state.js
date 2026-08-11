(() => {
  const isLive = item => item && !item.deleted;
  const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const isToday = time => { const now = new Date(), d = new Date(time || 0); return Number.isFinite(d.getTime()) && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate(); };
  const complete = state => {
    const date = dayKey(), fortune = state.fortune?.date === date ? (state.fortune.by || {}) : {};
    const todos = (state.todos || []).filter(item => isLive(item) && item.date === date);
    const todoDone = todos.length === 0 || todos.some(item => item.done);
    return ['a', 'b'].every(person => Boolean(fortune[person]) && Boolean(state.dailyStatus?.[date]?.[person]?.mood) && (state.messages || []).some(item => isLive(item) && item.author === person && isToday(item.createdAt)) && todoDone);
  };
  const showCompleteState = () => {
    const card = document.querySelector('#lifeApp .life-today-together .life-together-card');
    if (!card || card.dataset.completePet === 'true' || !window.PufferLife?.getState || !complete(window.PufferLife.getState())) return;
    card.dataset.completePet = 'true'; card.classList.add('life-together-complete');
    card.innerHTML = `<img class="life-complete-pet" src="assets/puffer-state-celebrate.png?v=1" alt="胖头鱼为你们庆祝"><div class="life-complete-copy"><b>今天被你们好好过完了</b><span>每个小互动，都收到了彼此的回应。</span></div>`;
  };
  const schedule = () => requestAnimationFrame(showCompleteState);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', schedule); schedule();
})();
