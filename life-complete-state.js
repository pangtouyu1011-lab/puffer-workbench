(() => {
  const complete = () => Boolean(window.PufferLife?.isTodayInteractionComplete?.());
  let frame = null;
  const syncCompleteState = () => {
    frame = null;
    const card = document.querySelector('#lifeApp .life-today-together .life-together-card');
    if (!card) return;
    const done = complete();
    card.classList.toggle('life-together-complete', done);
    const existing = card.querySelector('.life-complete-summary');
    if (!done) { existing?.remove(); return; }
    if (existing) return;
    const summary = document.createElement('div');
    summary.className = 'life-complete-summary';
    summary.setAttribute('role', 'status');
    summary.innerHTML = `<span class="life-complete-mark"><i class="ph ph-check"></i></span><img class="life-complete-pet" src="assets/puffer-state-celebrate.webp" alt="庆祝的胖头鱼"><div><b>今天的互动完成啦</b><small>内容都还在，随时可以回来看看。</small></div>`;
    summary.querySelector('.life-complete-pet')?.addEventListener('error', event => { event.currentTarget.hidden = true; });
    const challenge = card.querySelector('.life-challenge-entry');
    if (challenge) challenge.insertAdjacentElement('afterend', summary);
    else card.prepend(summary);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(syncCompleteState); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('puffer-state-change', schedule);
  window.addEventListener('focus', schedule); schedule();
})();
