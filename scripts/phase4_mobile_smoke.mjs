// Disposable API only. Focused mobile geometry and accessibility check.
export default async function run(page, ui) {
  await page.setViewportSize({ width: 390, height: 844 });
  const name = `mobile_qa_${Date.now()}`;
  const response = await page.request.post(new URL('/api/auth/register', page.url()).href, { data: { username: name, password: `qa-${crypto.randomUUID()}` } });
  if (response.status() !== 201) throw new Error('Disposable mobile account could not be created');
  await page.reload();
  await page.getByRole('button', { name: "I'll do this later" }).click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'For You', exact: true }).click();
  await page.getByRole('button', { name: /^View / }).first().waitFor({ timeout: 60000 });
  await ui.snapshot();
  return page.evaluate(() => ({
    viewport: innerWidth, width: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width && rect.right > innerWidth + 2 && getComputedStyle(element).position !== 'fixed';
    }).slice(0, 20).map(element => ({ tag: element.tagName, classes: element.className, width: element.getBoundingClientRect().width, text: element.textContent.slice(0, 60) }))
  }));
}
