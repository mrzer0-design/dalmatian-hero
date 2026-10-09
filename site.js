/* Store page: dummy cart, testimonial slider, gallery lightbox. */
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- dummy cart ---------- */

  const count = document.getElementById('cart-count');
  const toast = document.getElementById('toast');
  let items = 0;
  let toastTimer = 0;

  document.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      items += 1;
      count.textContent = items;
      count.classList.remove('is-bump');
      void count.offsetWidth; // restart the bump animation
      count.classList.add('is-bump');
      setTimeout(() => count.classList.remove('is-bump'), 250);
      toast.textContent = `${btn.dataset.add} added to your cart`;
      toast.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
    });
  });

  /* ---------- testimonial slider ---------- */

  const track = document.getElementById('slider-track');
  const dotsWrap = document.getElementById('slider-dots');
  if (track && dotsWrap) {
    const slides = [...track.children];
    let index = 0;

    const dots = slides.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Show review ${i + 1}`);
      b.addEventListener('click', () => { go(i); restart(); });
      dotsWrap.appendChild(b);
      return b;
    });

    function mark(i) {
      index = i;
      dots.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
    }

    function go(i) {
      const n = (i + slides.length) % slides.length;
      track.scrollTo({ left: n * track.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      mark(n);
    }

    // keep the dots in sync with swipes / trackpad scrolling
    let raf = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => mark(Math.round(track.scrollLeft / track.clientWidth)));
    }, { passive: true });

    document.querySelectorAll('.slider__btn').forEach((b) =>
      b.addEventListener('click', () => { go(index + Number(b.dataset.dir)); restart(); }));

    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); restart(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); restart(); }
    });

    // autoplay, paused on hover/focus and when off-screen
    let timer = 0;
    let paused = false;
    let visible = false;
    function restart() {
      clearInterval(timer);
      if (reduceMotion.matches || paused || !visible) return;
      timer = setInterval(() => go(index + 1), 6000);
    }
    const slider = track.closest('.slider');
    slider.addEventListener('pointerenter', () => { paused = true; restart(); });
    slider.addEventListener('pointerleave', () => { paused = false; restart(); });
    slider.addEventListener('focusin', () => { paused = true; restart(); });
    slider.addEventListener('focusout', () => { paused = false; restart(); });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; restart(); }).observe(slider);

    addEventListener('resize', () => track.scrollTo({ left: index * track.clientWidth }));
    mark(0);
  }

  /* ---------- gallery lightbox ---------- */

  const box = document.getElementById('lightbox');
  const frame = document.getElementById('lightbox-frame');
  if (box && frame && box.showModal) {
    document.querySelectorAll('.gallery__item').forEach((btn) => {
      const img = btn.querySelector('img');
      btn.setAttribute('aria-label', `View larger: ${img.alt}`);
      btn.addEventListener('click', () => {
        frame.replaceChildren(Object.assign(new Image(), { src: img.currentSrc || img.src, alt: img.alt }));
        box.showModal();
      });
    });
    document.getElementById('lightbox-close').addEventListener('click', () => box.close());
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  }
})();
