// Landing page motion: blocks rise in as they scroll into view. With reduced motion,
// or without JavaScript, everything shows complete and still.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!calm && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      e.target.classList.add('in');
      setTimeout(() => e.target.classList.remove('reveal', 'in'), 1400);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.06 });
  document.querySelectorAll('.reveal').forEach((el) => {
    const i = [...el.parentElement.children].filter((c) => c.classList.contains('reveal')).indexOf(el);
    el.style.setProperty('--d', Math.max(0, i) * 90 + 'ms');
    seen.observe(el);
  });
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.remove('reveal'));
}
