(() => {
  const complete = () => Boolean(window.PufferLife?.isTodayInteractionComplete?.());
  const showCompleteState = () => {
    const card = document.querySelector('#lifeApp .life-today-together .life-together-card');
    if (!card || card.dataset.completePet === 'true' || !complete()) return;
    card.dataset.completePet = 'true'; card.classList.add('life-together-complete');
    card.innerHTML = `<img class="life-complete-pet" src="assets/status-pet-complete.png?v=1" alt="胖头鱼为你们庆祝"><div class="life-complete-copy"><b>今天被你们好好过完了</b><span>每个小互动，都收到了彼此的回应。</span></div>`;
  };
  const schedule = () => requestAnimationFrame(showCompleteState);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', schedule); schedule();
})();
