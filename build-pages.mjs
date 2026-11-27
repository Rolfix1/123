import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const image = name => 'data:image/jpeg;base64,' + read(name + '.b64').replace(/\s/g, '');
const hero = image('hero');
const work = image('work');
const css = read('style.css').replaceAll('url("/hero.jpg")', 'var(--hero-image)')
  .replaceAll('url("/work.jpg")', 'var(--work-image)');
const script = read('site.js').replace("'/hero.jpg'", "document.querySelector('#road-frame').getAttribute('href')")
  .replace(/form\.addEventListener\('submit'[\s\S]*?\n\}\);/, `button.disabled = false;
form.addEventListener('submit', event => {
  event.preventDefault();
  result.textContent = 'Демонстрация завершена. Данные никуда не отправлены.';
});`);
const page = read('index.html')
  .replace('<link rel="stylesheet" href="/style.css">', () => `<style>:root{--hero-image:url("${hero}");--work-image:url("${work}")}\n${css}\n</style>`)
  .replace('<script src="/site.js" defer></script>', '')
  .replace('href="/hero.jpg"', () => `href="${hero}"`)
  .replace('action="/api/requests"', '')
  .replace('Тестовая форма.', 'Демонстрация записи без отправки заявки.')
  .replace('type="submit">Отправить заявку', 'type="submit" disabled>Проверить форму')
  .replace('<a href="/owner">Вход для владельца ↗</a>', '')
  .replace('</body>', () => `<script>\n${script}\n</script></body>`);
const output = process.argv[2] || 'github-pages';
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'index.html'), page);
