# Getting set up

For the person setting up, in plain steps. When a setup check fails, read them the step
that fixes it, in your own words, one step at a time. The README carries the same steps
in the email sent with the skill.

## What you need

- The **Claude desktop app**, signed in, with **Cowork**.
- The **address of your website** (for example `acme.com`), and a way to **sign in to
  its editor**: your Squarespace, WordPress, Shopify or Craft login.
- The file **`website-skill.zip`**. Don't unzip it.

## 1. Let Claude run code

Open **Settings → Capabilities** and turn on **Code execution and file creation**.

✓ The switch is on. On a Team or Enterprise plan, if you can't change it, ask whoever
manages Claude for your organization (an Owner) to turn it on, and to allow skills.

## 2. Let Claude reach your website

On the same Capabilities page, allow network access for your website's address, for
example `acme.com`. On a Team or Enterprise plan only an Owner can do this, under
**Organization settings → Capabilities → Code execution**: turn on network access and
add the site's address.

✓ Your site's address is in the list of allowed sites. If you can't do this, carry on:
Claude asks again at the start, and can do the same work through the browser, more
slowly.

## 3. Install the skill

Open **Customize → Skills**, click **+**, then **Create skill → Upload a skill**, and
choose `website-skill.zip`.

✓ **website** is in your list of skills, and its switch is on.

## 4. Make a folder for the site

Make a new, **empty** folder on your computer for this one website, for example
`Documents/Websites/Acme website`. Everything Claude learns about the site is kept here.
If you look after several sites, make one folder for each.

✓ The folder exists and is empty.

## 5. Make a Cowork project for the site

In **Cowork**, create a new project (for example "Acme Website") and **attach the folder**
from step 4. It needs no description or instructions.

✓ The project shows your folder. Use one project per site, always with that site's folder.

## 6. Have a browser ready

Claude works in your site's editor through a browser:

- If you use **Chrome**, install **Claude in Chrome**. Claude then uses the Chrome where
  you're already signed in to your site.
- Otherwise, Claude uses the **Claude app's built-in browser**. The first time it opens
  a site, the app asks you to allow it. Allow your site, and its editor's address when
  asked (on Squarespace that is a separate `….squarespace.com` address).

## 7. Start

In the Cowork project, **start a new chat** and type:

> /website setup acme.com

(or "Set up the website skill for acme.com"). Then follow Claude:

1. **It checks everything first** and tells you if something above needs fixing.
2. **It confirms the folder and the site**, and asks what your site is built on if it
   can't tell.
3. **It asks you to sign in** to your site's editor in the browser. You sign in
   yourself; Claude never sees or stores your password.
4. **It captures your whole site** while you watch: every page, a check for problems on
   phones, tablets and desktops, how your editor works, and your colours, fonts and
   building blocks. Nothing on your site is changed.
5. **It finishes with one fix to try**, something it noticed on your site, as a test
   that everything works, and a few ideas for later.

## Afterwards

- **Always start new chats inside that same Cowork project.** That's how Claude
  remembers your site. Just say what you'd like to do.
- **When there's a new version of the skill**, go to **Customize → Skills**, delete the
  old **website** skill (**…** next to its switch → **Delete**), and upload the new zip as
  in step 3. Then, in your site's project, say "**/website setup**". Claude brings your
  folder up to date and finishes anything new.
- **To send feedback**, say "**/website feedback**". Claude bundles what it has learned
  about your site and your conversations into one file for you to send to the skill
  author. You can open it to check first.

## If something goes wrong

| What you see | What to do |
|---|---|
| Claude says this isn't a Cowork project, or there's no folder | Do steps 4 and 5, then start a new chat in that project |
| Claude can't reach your site | Do step 2, or let Claude carry on through the browser |
| Claude has no browser | Do step 6 |
| You can't upload the skill | Step 1 is probably off |
| Claude doesn't seem to know the skill | Check the **website** switch in step 3, and type "/website setup" |
