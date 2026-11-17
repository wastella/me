import { test, expect, unique, quickAdd, addTask, row, localDate } from './fixtures.mjs';

const PAGES = [['/', 'Home'], ['/tasks', 'Tasks'], ['/tasks?view=upcoming', 'Upcoming'], ['/tasks?view=done', 'Completed'], ['/calendar', 'Calendar'], ['/notes', 'Notes'], ['/training', 'Training'], ['/settings', 'Settings']];

test.describe('every screen', () => {
  for (const [path, name] of PAGES) {
    test(`${name} loads cleanly and fits the screen`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).not.toBeEmpty();
      await expect(page.locator('.skel')).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
    });
  }

  test('navigation reaches every section', async ({ page, phone }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Tasks', 'Calendar', 'Notes', 'Training', 'Home']) {
      await nav.getByRole('link', { name: label }).click();
      await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    }
    // Settings: in the sidebar on a computer, behind the gear on Home on a phone.
    await (phone ? page.getByRole('link', { name: 'Settings' }) : nav.getByRole('link', { name: 'Settings' })).click();
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });
});

test.describe('tasks', () => {
  test('quick add understands dates, priority and projects', async ({ page }) => {
    const name = unique('Buy milk');
    const project = unique('Errands').replace(' ', '');
    await page.goto('/tasks');
    await quickAdd(page).fill(`${name} tomorrow p1 #${project}`);
    await expect(page.getByText('Tomorrow', { exact: false }).first()).toBeVisible();   // the preview chips
    await expect(page.getByText(`New project: ${project}`)).toBeVisible();
    await quickAdd(page).press('Enter');
    await expect(page.getByRole('status').filter({ hasText: `Added “${name}”` })).toBeVisible();
    await expect(quickAdd(page)).toHaveValue('');
    await expect(row(page, name)).toHaveCount(0);   // not in Today
    await page.goto('/tasks?view=upcoming');
    await expect(row(page, name)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Task views' }).getByRole('button', { name: new RegExp(project) })).toBeVisible();
  });

  test('completing a task can be undone', async ({ page }) => {
    const name = unique('Finish me');
    await page.goto('/');
    await addTask(page, name);
    await page.getByRole('button', { name: `Complete “${name}”` }).click();
    await expect(row(page, name)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row(page, name)).toBeVisible();
    await page.reload();
    await expect(row(page, name)).toBeVisible();
  });

  test('completed tasks appear in the Completed list', async ({ page }) => {
    const name = unique('Log me');
    await page.goto('/tasks');
    await addTask(page, name);
    await page.getByRole('button', { name: `Complete “${name}”` }).click();
    await expect(row(page, name)).toHaveCount(0);
    await page.goto('/tasks?view=done');
    await expect(row(page, name)).toBeVisible();
  });

  test('a repeating task moves to its next date when done', async ({ page }) => {
    const name = unique('Water plants');
    await page.goto('/tasks');
    await addTask(page, `${name} every day`);
    await page.getByRole('button', { name: `Complete “${name}”` }).click();
    await expect(page.getByRole('status').filter({ hasText: 'next tomorrow' })).toBeVisible();
    await expect(row(page, name)).toHaveCount(0);
    await page.goto('/tasks?view=upcoming');
    await expect(row(page, name)).toBeVisible();
  });

  test('editing: rename, deadline, repeat, and Esc to close', async ({ page }) => {
    const name = unique('Draft essay');
    const renamed = unique('Final essay');
    await page.goto('/tasks');
    await addTask(page, name);
    await row(page, name).getByText(name).click();
    const sheet = page.getByRole('dialog', { name: 'Task details' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Task name' }).fill(renamed);
    await sheet.getByRole('textbox', { name: 'Task name' }).press('Enter');
    await sheet.getByLabel('Deadline').fill(await localDate(page, 1));
    await sheet.getByLabel('Repeat').fill('every now and then');
    await sheet.getByLabel('Repeat').blur();
    await expect(sheet.getByText('Try “every monday”')).toBeVisible();
    await sheet.getByLabel('Repeat').fill('every 2 days');
    await sheet.getByLabel('Repeat').blur();
    await sheet.getByRole('button', { name: 'P2' }).click();
    await expect(sheet.getByRole('button', { name: 'P2' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    const r = row(page, renamed);
    await expect(r).toContainText('Every 2 days');
    await expect(r).toContainText('Due tomorrow');
    await page.reload();
    await expect(row(page, renamed)).toContainText('Due tomorrow');   // it really saved
    await expect(row(page, name)).toHaveCount(0);
  });

  test('subtasks can be added and finish with their parent', async ({ page }) => {
    const name = unique('Parent');
    const kid = unique('Child');
    await page.goto('/tasks');
    await addTask(page, name);
    await row(page, name).getByText(name).click();
    const sheet = page.getByRole('dialog', { name: 'Task details' });
    await sheet.getByRole('textbox', { name: 'Add a subtask' }).fill(kid);
    await sheet.getByRole('textbox', { name: 'Add a subtask' }).press('Enter');
    await expect(row(sheet, kid)).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(row(page, kid)).toBeVisible();
    await page.getByRole('button', { name: `Complete “${name}”` }).click();
    await expect(row(page, kid)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row(page, kid)).toBeVisible();
  });

  test('deleting asks first', async ({ page }) => {
    const name = unique('Delete me');
    await page.goto('/tasks');
    await addTask(page, name);
    await row(page, name).getByText(name).click();
    await page.getByRole('button', { name: 'Delete task' }).click();
    const ask = page.getByRole('dialog', { name: 'Delete this task?' });
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'Task details' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete task' }).click();
    await ask.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row(page, name)).toHaveCount(0);
    await page.reload();
    await expect(row(page, name)).toHaveCount(0);
  });

  test('projects: create, add a section, rename, delete', async ({ page }) => {
    const name = unique('Proj');
    const renamed = unique('Renamed');
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeDisabled();
    await dialog.getByRole('textbox').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await addTask(page, 'Inside the project');

    await page.getByRole('button', { name: 'Project options' }).click();
    await page.getByRole('menuitem', { name: 'Add section' }).click();
    await page.getByRole('dialog', { name: 'New section' }).getByRole('textbox').fill('Later');
    await page.getByRole('dialog', { name: 'New section' }).getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Later', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Project options' }).click();
    await page.getByRole('menuitem', { name: 'Rename project' }).click();
    await page.getByRole('dialog', { name: 'Rename project' }).getByRole('textbox').fill(renamed);
    await page.getByRole('dialog', { name: 'Rename project' }).getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByRole('heading', { name: renamed, level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Project options' }).click();
    await page.getByRole('menuitem', { name: 'Delete project' }).click();
    const ask = page.getByRole('dialog', { name: `Delete “${renamed}”?` });
    await expect(ask).toContainText('1 open task');
    await ask.getByRole('button', { name: 'Delete project' }).click();
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Task views' }).getByRole('button', { name: renamed })).toHaveCount(0);
  });

  test('if saving fails, it says so and keeps what you typed', async ({ page }) => {
    page.expectErrors();
    await page.goto('/tasks');
    await page.route('**/api/tasks', (r) => (r.request().method() === 'POST' ? r.abort() : r.fallback()));
    await quickAdd(page).fill('Typed while offline');
    await quickAdd(page).press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Can’t reach Me' })).toBeVisible();
    await expect(quickAdd(page)).toHaveValue('Typed while offline');
  });

  test('keyboard: Q jumps to quick add', async ({ page, phone }) => {
    test.skip(phone, 'keyboard shortcuts are for the computer');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tester');
    await page.keyboard.press('q');
    await expect(quickAdd(page)).toBeFocused();
    await page.keyboard.type('typed with keys');
    await expect(quickAdd(page)).toHaveValue('typed with keys');
    await page.keyboard.press('Escape');
    await expect(quickAdd(page)).toHaveValue('');
  });

  test('keyboard: Q adds a task from a screen with no add box', async ({ page, phone }) => {
    test.skip(phone, 'keyboard shortcuts are for the computer');
    const name = unique('From notes');
    await page.goto('/notes');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes');
    await page.keyboard.press('q');
    const sheet = page.getByRole('dialog', { name: 'Add a task' });
    await expect(sheet.getByRole('textbox')).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(sheet).toHaveCount(0);
    await page.goto('/tasks');
    await expect(row(page, name)).toBeVisible();
  });

  test('row menu reschedules, and search finds the task', async ({ page, phone }) => {
    test.skip(phone, 'the row menu appears on hover, which a phone does not have');
    const name = unique('Hover me');
    await page.goto('/tasks');
    await addTask(page, name);
    await row(page, name).hover();
    await row(page, name).getByRole('button', { name: 'Reschedule' }).click();
    await page.getByRole('menuitem', { name: /Tomorrow/ }).click();
    await expect(row(page, name)).toHaveCount(0);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search tasks' })).toBeFocused();
    await page.keyboard.type(name.slice(-6));
    await expect(row(page, name)).toContainText('Tomorrow');
  });

  test('one tap moves a task to tomorrow', async ({ page }) => {
    const name = unique('Move me');
    await page.goto('/tasks');
    await addTask(page, name);
    await row(page, name).getByText(name).click();
    const sheet = page.getByRole('dialog', { name: 'Task details' });
    await sheet.getByRole('button', { name: 'Tomorrow' }).click();
    await expect(sheet.getByLabel('Date', { exact: true })).toHaveValue(await localDate(page, 1));
    await page.keyboard.press('Escape');
    await expect(row(page, name)).toHaveCount(0);
  });
});

test.describe('home', () => {
  test('shows today’s schedule and tasks', async ({ page }) => {
    const name = unique('Home task');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)|Up late/);
    const schedule = page.getByRole('region', { name: 'Schedule' });
    await expect(schedule.getByText('Essay due')).toBeVisible();
    await expect(schedule.getByText('Club meeting')).toHaveCount(0);   // that one is tomorrow
    await addTask(page, name);
    await expect(page.getByRole('region', { name: /^Today/ }).getByText(name)).toBeVisible();
  });

  test('shows tonight’s dinner and the week from Mealboard', async ({ page }) => {
    await page.goto('/');
    const dinner = page.getByRole('region', { name: 'Dinner' });
    await expect(dinner.locator('.meal-tonight')).toHaveText('Chicken tacos');
    await expect(dinner.getByText('Tomorrow')).toBeVisible();
    await expect(dinner.getByText('Spaghetti and meatballs')).toBeVisible();
    await expect(dinner.getByText('Homemade pizza')).toBeVisible();
  });
});

test.describe('calendar', () => {
  test('views, event details and adding an event', async ({ page, phone }) => {
    await page.goto('/calendar');
    const views = page.getByRole('group', { name: 'Calendar view' });
    await expect(views.getByRole('button', { name: phone ? 'Day' : 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Dentist' }).first().click();
    const details = page.getByRole('dialog', { name: 'Dentist' });
    await expect(details).toContainText('123 Main St');
    await details.getByRole('button', { name: 'Close' }).click();
    await expect(details).toHaveCount(0);

    await views.getByRole('button', { name: 'Month' }).click();
    await expect(page.locator('.month-grid')).toBeVisible();
    await views.getByRole('button', { name: 'Day' }).click();
    await expect(page.locator('.week.is-day')).toBeVisible();

    await page.getByRole('button', { name: 'New event' }).click();
    const form = page.getByRole('dialog', { name: 'New event' });
    await expect(form.getByRole('button', { name: 'Add event' })).toBeDisabled();
    await form.getByRole('textbox', { name: 'Title' }).fill('Study group');
    await form.getByRole('button', { name: 'Add event' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Added “Study group”' })).toBeVisible();
    await expect(form).toHaveCount(0);
  });

  test('change an event, and click an empty slot to add one', async ({ page }) => {
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Dentist' }).first().click();
    await page.getByRole('dialog', { name: 'Dentist' }).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit event' });
    await expect(edit.getByRole('textbox', { name: 'Title' })).toHaveValue('Dentist');
    await expect(edit.getByLabel('Start time')).toHaveValue('12:00');
    await expect(edit.getByLabel('End time')).toHaveValue('13:00');
    await edit.getByLabel('Start time').fill('14:00');
    await expect(edit.getByLabel('End time')).toHaveValue('15:00');   // keeps its length
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Event updated' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('.day-col.today').click({ position: { x: 20, y: 52 * 9 + 10 } });   // 9am
    const form = page.getByRole('dialog', { name: 'New event' });
    await expect(form.getByLabel('Start time')).toHaveValue('09:00');
    await expect(form.getByLabel('End time')).toHaveValue('10:00');
  });

  test('keyboard: D, W, M switch views', async ({ page, phone }) => {
    test.skip(phone, 'keyboard shortcuts are for the computer');
    await page.goto('/calendar');
    const views = page.getByRole('group', { name: 'Calendar view' });
    await expect(views.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('m');
    await expect(views.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('d');
    await expect(views.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('w');
    await expect(views.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('notes', () => {
  test('write, edit, pin and delete a note', async ({ page }) => {
    const title = unique('Note');
    const edited = unique('Edited');
    await page.goto('/notes');
    await page.getByRole('textbox', { name: 'New note' }).fill(`${title}\nsecond line`);
    await page.getByRole('button', { name: 'Save' }).click();
    const card = page.getByRole('button', { name: new RegExp(title) });
    await expect(card).toContainText('second line');
    await expect(page.getByRole('textbox', { name: 'New note' })).toHaveValue('');

    await card.click();
    const editor = page.getByRole('dialog', { name: 'Edit note' });
    await editor.getByRole('textbox', { name: 'Note' }).fill(`${edited}\nchanged`);
    await editor.getByRole('button', { name: 'Pin to top' }).click();
    await editor.getByRole('button', { name: 'Done' }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('button', { name: new RegExp(edited) })).toContainText('changed');
    await expect(page.locator('.notes-grid > *').first()).toContainText(edited);   // pinned notes come first

    await page.getByLabel('Search notes').fill('zzz-not-there');
    await expect(page.getByText('No notes match')).toBeVisible();
    await page.getByLabel('Search notes').fill(edited);
    await page.getByRole('button', { name: new RegExp(edited) }).click();
    await editor.getByRole('button', { name: 'Delete note' }).click();
    await page.getByRole('dialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: new RegExp(edited) })).toHaveCount(0);
  });

  test('categories file notes and can be removed without losing them', async ({ page }) => {
    const cat = unique('Cat');
    const title = unique('Filed');
    await page.goto('/notes');
    await page.getByRole('button', { name: 'New category' }).click();
    await page.getByRole('dialog', { name: 'New category' }).getByRole('textbox').fill(cat);
    await page.getByRole('dialog', { name: 'New category' }).getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: cat, level: 1 })).toBeVisible();
    await page.getByRole('textbox', { name: 'New note' }).fill(title);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
    await page.getByRole('button', { name: 'Category options' }).click();
    await page.getByRole('menuitem', { name: 'Delete category' }).click();
    const ask = page.getByRole('dialog', { name: `Delete “${cat}”?` });
    await expect(ask).toContainText('1 note will move to Unsorted');
    await ask.getByRole('button', { name: 'Delete category' }).click();
    await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(title) })).toBeVisible();
  });
});

test.describe('training', () => {
  test('build a routine, tick posture, log and delete a workout', async ({ page }) => {
    const step = unique('Stretch');
    const lift = unique('Press');
    await page.goto('/training');
    await page.getByRole('button', { name: 'Edit routine' }).click();
    const routine = page.getByRole('dialog', { name: 'Routine' });
    await routine.getByRole('button', { name: 'Add step' }).click();
    await page.getByRole('dialog', { name: 'New posture step' }).getByRole('textbox').fill(step);
    await page.getByRole('dialog', { name: 'New posture step' }).getByRole('button', { name: 'Add' }).click();
    await routine.getByRole('button', { name: 'Add exercise' }).first().click();
    await page.getByRole('dialog', { name: 'New upper exercise' }).getByRole('textbox').fill(lift);
    await page.getByRole('dialog', { name: 'New upper exercise' }).getByRole('button', { name: 'Add' }).click();
    await expect(routine.getByRole('button', { name: `Remove ${lift}` })).toBeVisible();
    await routine.getByRole('button', { name: 'Close' }).click();

    const tick = page.getByRole('button', { name: step });
    await tick.click();
    await expect(tick).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: step })).toHaveAttribute('aria-pressed', 'true');

    const weight = page.getByRole('textbox', { name: `${lift} weight in pounds` });
    await weight.fill('100');
    await page.getByRole('button', { name: `${lift}: 5 lb more` }).click();
    await expect(weight).toHaveValue('105');
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Upper day logged' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upper day logged' })).toBeVisible();
    await expect(page.getByText('105 lb').first()).toBeVisible();

    await page.getByRole('button', { name: /^Edit upper workout/ }).first().click();
    await page.getByRole('button', { name: 'Delete workout' }).click();
    await page.getByRole('dialog', { name: 'Delete this workout?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Finish workout' })).toBeVisible();
  });
});

test.describe('dialogs', () => {
  test('keep keyboard focus inside and give it back afterwards', async ({ page, phone }) => {
    test.skip(phone, 'keyboard focus is for the computer');
    await page.goto('/tasks');
    const opener = page.getByRole('button', { name: 'New project' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await expect(dialog.getByRole('textbox')).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), 'focus stays in the dialog').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});
