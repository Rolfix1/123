const form = document.querySelector('#request');
const result = document.querySelector('#result');
const button = form.querySelector('button');

const hero = document.querySelector('.hero');
const replay = document.querySelector('.arrival-replay');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const heroImage = new Image();
heroImage.src = '/hero.jpg';

function playArrival() {
  if (reducedMotion.matches) return;
  hero.classList.remove('arriving');
  void hero.offsetWidth;
  hero.classList.add('arriving');
}
heroImage.decode().then(() => {
  replay.hidden = false;
  if (window.scrollY < hero.clientHeight && document.visibilityState === 'visible') playArrival();
}).catch(() => {});
replay.addEventListener('click', playArrival);


document.querySelectorAll('[data-service]').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelector('#service').value = link.dataset.service;
  });
});

document.querySelector('#comparison').addEventListener('input', event => {
  document.querySelector('#compare').style.setProperty('--split', event.target.value + '%');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  result.textContent = 'Отправляем заявку…';
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams(new FormData(form)),
    });
    const data = await response.json();
    if (!response.ok) {
      result.textContent = data.error;
      return;
    }
    form.reset();
    result.textContent = 'Заявка сохранена. Номер ' + data.id.slice(0, 8).toUpperCase() + '.';
  } catch {
    result.textContent = 'Не удалось связаться с сервером. Попробуйте ещё раз.';
  } finally {
    button.disabled = false;
  }
});

const track = document.querySelector('.reviews');
const [previous, next] = document.querySelectorAll('.review-controls button');
function stepReview(direction) {
  const distance = track.children[1].offsetLeft - track.children[0].offsetLeft;
  track.scrollBy({ left: direction * distance, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
function updateArrows() {
  previous.disabled = track.scrollLeft < 2;
  next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
}
previous.addEventListener('click', () => stepReview(-1));
next.addEventListener('click', () => stepReview(1));
track.addEventListener('scroll', updateArrows);
new ResizeObserver(updateArrows).observe(track);
updateArrows();
