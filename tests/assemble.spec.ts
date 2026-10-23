import { expect, test, type Page } from '@playwright/test';
import { initialState, STORAGE_KEY } from '../src/build';
import { INNER_COUNT, KIT_COUNT, OUTER_COUNT, WIRE_COUNT } from '../src/layout';

test.use({ reducedMotion: 'reduce' });

const panel = (page: Page) => page.locator('.panel');
const heading = (page: Page) => panel(page).getByRole('heading', { level: 1 });
const ready = async (page: Page) => {
  await page.goto('/');
  await expect(page.locator('.board[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
};
const press = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true }).click();
const saved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORAGE_KEY);

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Could not restore')) throw new Error(m.text()); });
  // The sandboxed test browser has no route to YouTube; the embed is only checked for existence.
  page.on('requestfailed', (r) => { if (!r.url().includes('youtube-nocookie.com')) throw new Error(`Request failed: ${r.url()}`); });
});

test('first viewport shows the lamp stage and the next action, with no video', async ({ page }) => {
  await ready(page);
  const canvas = await page.locator('.board-canvas').boundingBox();
  expect(canvas!.height).toBeGreaterThan(250);
  await expect(panel(page).locator('.primary')).toBeInViewport({ ratio: 1 });
  await expect(panel(page).locator('.primary')).toHaveText('Unpack base');
  await expect(heading(page)).toHaveText('Unpack the kit.');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('a[href*="youtu"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the primary button alone builds the whole lamp', async ({ page }) => {
  await ready(page);
  const seen = new Set<string>();
  for (let i = 0; i < 120; i++) {
    const primary = panel(page).locator('.primary');
    if (!(await primary.count())) break;
    seen.add((await heading(page).textContent())!);
    await primary.click();
  }
  await expect(heading(page)).toHaveText('Go explore Universe.');
  expect([...seen]).toEqual([
    'Unpack the kit.', 'Red, green, white into 1, 3, 4.', 'Test the LEDs.', 'Strip along the outer ring.',
    'Strip around the inner ring and Mona.', 'Cut off the excess.', 'Check it glows green.', 'Assemble the lamp.',
    'Final test.', 'Tidy the desk.', 'Pack the lamp.',
  ]);
  await expect(panel(page).getByText('WLED-AP')).toBeVisible();
  expect(await saved(page)).toMatchObject({ stripPowered: true, finalPowered: true, assembled: 5, tidied: true, packed: true });
});

test('"Do all" finishes each step in turn', async ({ page }) => {
  await ready(page);
  for (const next of ['Red, green, white into 1, 3, 4.', 'Test the LEDs.', 'Strip along the outer ring.',
    'Strip around the inner ring and Mona.', 'Assemble the lamp.', 'Final test.']) {
    await press(page, 'Do all');
    await expect(heading(page)).toHaveText(next);
  }
  await expect(panel(page).getByRole('button', { name: 'Do all', exact: true })).toHaveCount(0);
  await press(page, 'Plug in USB');
  await expect(heading(page)).toHaveText('Tidy the desk.');
  await press(page, 'Do all');
  await expect(heading(page)).toHaveText('Go explore Universe.');
});

test('follows UNIVERSE_ASSEMBLY.md step 4 and 5: trim, power, check green, then reflector and the rest', async ({ page }) => {
  await ready(page);
  for (let i = 0; i < 4; i++) await press(page, 'Do all');
  await expect(heading(page)).toHaveText('Strip around the inner ring and Mona.');
  await press(page, 'Do all');
  await expect(heading(page)).toHaveText('Assemble the lamp.');
  expect(await saved(page)).toMatchObject({ trimmed: true, stripPowered: true, assembled: 0 });
  const labels: string[] = [];
  for (let i = 0; i < 5; i++) {
    labels.push((await panel(page).locator('.primary').textContent())!);
    await panel(page).locator('.primary').click();
  }
  expect(labels).toEqual(['Thread wires', 'Flip, seat board', 'Feed USB', 'Snap cover', 'Press together']);
});

test('shows the two guide warnings only at the test step', async ({ page }) => {
  await ready(page);
  await press(page, 'Do all');
  await press(page, 'Do all');
  await expect(panel(page).getByText('Never power a coiled strip.')).toBeVisible();
  await press(page, 'Uncoil strip');
  await expect(panel(page).getByText('Arrows point away from the connector.')).toBeVisible();
  await press(page, 'Connect strip');
  await press(page, 'Plug in USB');
  await expect(heading(page)).toHaveText('Strip along the outer ring.');
  await expect(panel(page).getByText(/coiled|Arrows/)).toHaveCount(0);
});

test('counts progress and undoes one step at a time', async ({ page }) => {
  await ready(page);
  await press(page, 'Unpack base');
  await press(page, 'Unpack cover');
  await expect(panel(page).getByText(`2/${KIT_COUNT} parts`)).toBeVisible();
  await press(page, 'Undo');
  await expect(panel(page).getByText(`1/${KIT_COUNT} parts`)).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(panel(page).getByText(`0/${KIT_COUNT} parts`)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('keeps the build across a reload, and Start over asks first', async ({ page }) => {
  await ready(page);
  await press(page, 'Do all');
  await press(page, 'Do all');
  await page.reload();
  await expect(page.locator('.board[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
  await expect(heading(page)).toHaveText('Test the LEDs.');
  await press(page, 'Start over');
  await expect(panel(page).getByRole('button', { name: 'Erase and start over' })).toBeVisible();
  await press(page, 'Cancel');
  await expect(heading(page)).toHaveText('Test the LEDs.');
  await press(page, 'Start over');
  await press(page, 'Erase and start over');
  await expect(heading(page)).toHaveText('Unpack the kit.');
  expect(await saved(page)).toEqual(initialState);
});

test('explains a corrupt save and does not overwrite it until Start over', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{"laidOut":99}'), STORAGE_KEY);
  await ready(page);
  await expect(panel(page).getByRole('alert')).toContainText('could not be restored');
  await press(page, 'Unpack base');
  expect(await saved(page)).toEqual({ laidOut: 99 });
  await press(page, 'Start over');
  await press(page, 'Erase and start over');
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  expect(await saved(page)).toEqual(initialState);
});

test('works from the keyboard: Enter takes the primary action', async ({ page }) => {
  await ready(page);
  await page.locator('h1').focus();
  await page.keyboard.press('Enter');
  await expect(panel(page).getByText(`1/${KIT_COUNT} parts`)).toBeVisible();
  await page.locator('.board-canvas').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Home');
});

test('has exact wiring and strip counts in the saved build', async ({ page }) => {
  await ready(page);
  await press(page, 'Do all');
  for (let i = 0; i < WIRE_COUNT; i++) await press(page, 'Loosen terminal');
  for (let i = 0; i < WIRE_COUNT; i++) await press(page, 'Insert wire');
  for (let i = 0; i < WIRE_COUNT; i++) await press(page, 'Tighten terminal');
  await press(page, 'Do all');
  await expect(heading(page)).toHaveText('Strip along the outer ring.');
  await press(page, 'Do all');
  expect(await saved(page)).toMatchObject({ outer: OUTER_COUNT, inner: 0 });
  await press(page, 'Do all');
  expect(await saved(page)).toMatchObject({ inner: INNER_COUNT, trimmed: true, stripPowered: true });
});

test('guide has exactly one click-to-play embed', async ({ page }) => {
  await page.goto('/#/guide');
  await expect(page.getByRole('heading', { name: 'Guide' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play walkthrough' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/Ya8gMkDxdD4/);
});

test('view modes switch like GitHub\'s STL viewer and keep the build', async ({ page }) => {
  await ready(page);
  await press(page, 'Do all');
  const group = page.getByRole('radiogroup', { name: 'View mode' });
  await expect(group.getByLabel('Solid')).toBeChecked();
  await expect(group.getByLabel('X-ray')).toHaveCount(0);
  for (const mode of ['Wireframe', 'Angle', 'Solid']) {
    await group.getByText(mode, { exact: true }).click();
    await expect(group.getByLabel(mode, { exact: true })).toBeChecked();
  }
  await group.getByLabel('Wireframe').focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByLabel('Angle')).toBeChecked();
  await expect(heading(page)).toHaveText('Red, green, white into 1, 3, 4.');
});

test('steps through the parts on the desk and returns to the overview', async ({ page }) => {
  await ready(page);
  const nav = page.getByRole('group', { name: 'Move between parts' });
  const showing = (name: string) => expect(nav.getByText(name, { exact: true })).toBeVisible();
  const next = () => nav.getByRole('button', { name: 'Next part' }).click();
  await showing('Tap a part');
  await press(page, 'Unpack base');
  await press(page, 'Unpack cover');
  await next();
  await showing('base');
  await next();
  await showing('cover');
  await next();
  await showing('base');
  await nav.getByRole('button', { name: 'Previous part' }).click();
  await showing('cover');
  await page.locator('.board-canvas').focus();
  await page.keyboard.press(']');
  await showing('base');
  await page.keyboard.press('+');
  await page.keyboard.press('Shift+ArrowLeft');
  await nav.getByRole('button', { name: 'Overview' }).click();
  await showing('Tap a part');
  await next();
  await press(page, 'Unpack LED holder');
  await showing('Tap a part');
});

test('header links the GitHub icon to the repo, and the guide shows the video thumbnail before playing', async ({ page }) => {
  await page.goto('/#/guide');
  await expect(page.getByRole('link', { name: 'Octolamp Assemble on GitHub' })).toHaveAttribute('href', 'https://github.com/juliamuiruri4/octolamp-assemble');
  const play = page.getByRole('button', { name: 'Play walkthrough' });
  await expect(play).toBeVisible();
  expect(await play.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('guide-video.webp');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('packing: the Universe box appears for the final test and closes over the lamp', async ({ page }) => {
  await ready(page);
  for (let i = 0; i < 6; i++) await press(page, 'Do all');
  await press(page, 'Plug in USB');
  await expect(heading(page)).toHaveText('Tidy the desk.');
  await press(page, 'Tidy up');
  await expect(heading(page)).toHaveText('Pack the lamp.');
  await press(page, 'Pack lamp');
  await expect(heading(page)).toHaveText('Go explore Universe.');
});

test('header keeps the brand, nav and GitHub icon on one line', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 820 });
  await page.goto('/#/guide');
  await expect(page.getByText("GitHub Universe '26", { exact: true })).toHaveCount(0);
  const centres = await page.evaluate(() => [...document.querySelectorAll('.top .brand > *, .top nav a')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
  expect(new Set(centres).size).toBe(1);
});
