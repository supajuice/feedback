# Supa Juice reviews and suggestions

Customers leave a **review** (stars, an optional few words, and whether we may post it) or a **suggestion** on one page. Everything lands in a Google Sheet that only the shop account can see.

```
Reviews page (GitHub Pages)  ->  Apps Script web app  ->  "Supa Juice Feedback" Google Sheet
https://supajuice.co.za/feedback/                              |
                                                               +-- reads (never writes) the order Sheet,
                                                                   to mark reviews from real buyers
```

This repo is separate from the order site (`supajuice/supajuice.github.io`) and the books (`supajuice/books`):
- its own GitHub Pages site, so a push here never changes the order page;
- its own Google Sheet and Apps Script, with its own web address;
- the order site's trial page links here (**Reviews** in the header, and the footer links).

## Files

| File | What it is |
|---|---|
| `docs/index.html` | The page. A toggle switches between a review and a suggestion; `#suggest` in the address opens the suggestion side |
| `docs/feedback.js`, `docs/feedback.css` | What the page does, and its own look |
| `docs/config.js` | The one file you edit on the website side: the feedback web app address. Empty means demo mode: the page says thank you and sends nothing |
| `docs/app.css`, `docs/shop.css`, `docs/ig-colour.js`, `docs/fonts/`, `docs/img/` | Copies of the trial page's look, header, footer and Instagram button. If the shop's look changes, copy the new versions in |
| `apps-script/Code.gs` | The backend. Pasted into the Feedback Sheet's script editor |
| `SETUP-GUIDE.md` | Making the Sheet, connecting it to the order Sheet, and publishing it, click by click |
| `tests/` | A stand-in for Google's services, a local test server, and the tests |

## Turning on the website (once)

In this repo on GitHub: **Settings > Pages**, *Source: Deploy from a branch*, branch **main**, folder **/docs**, **Save**. A minute later it is live at https://supajuice.co.za/feedback/ (the shop's domain covers every Supa Juice repo).

## Trying it on your laptop

```
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev
```

- **http://127.0.0.1:5193/** is the page, sending to a fake feedback service.
- **http://127.0.0.1:5193/sheet** shows the pretend Feedback Sheet. Reload it after sending something.
- The pretend order Sheet has two buyers: **thandi@example.com** (SJ-0001, delivered) and **liam@example.com** (SJ-0003, paid). Any other email is saved as *Verified buyer: no*.

Nothing is saved: stop the server and it is gone.

`npm test` runs the backend tests and the browser tests. GitHub runs them on every push too.

## Privacy

- The email is asked for only to check the person bought gels, and the page says so. Never add these emails to marketing.
- The page never says whether an email was found, so nobody can use it to see who has ordered.
- A review is only shown anywhere with **May post: yes**, and then only the stars and words.

More in [SETUP-GUIDE.md](SETUP-GUIDE.md).
