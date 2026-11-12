# Setting up reviews and suggestions

About 15 minutes, once. This connects the **Reviews** page (this repo's `docs/index.html`, at https://supajuice.co.za/feedback/) to its own Google Sheet.

Everything here is separate from the orders:
- a new Google Sheet, **Supa Juice Feedback**;
- a new Apps Script (`apps-script/Code.gs`), with its own web address.

The order site and its `Code.gs` are not touched. To mark a review as coming from a real buyer, the feedback script **reads** the order Sheet and never changes it.

## Before you start

- Use a **computer**, not a phone.
- Be signed in to the **shop Google account**, the one that owns the order Sheet. If you have several accounts, use a private/incognito window with only the shop account signed in.

## 1. Make the Sheet

1. Go to [sheets.new](https://sheets.new) and name it **Supa Juice Feedback**.
2. Leave it empty. The script makes the **Reviews** and **Suggestions** tabs itself in step 4.

## 2. Paste in the script

1. In the new Sheet, open **Extensions > Apps Script**.
2. Click **Untitled project** at the top left and rename it **Supa Juice Feedback**.
3. Delete the sample code in `Code.gs`.
4. Open [`apps-script/Code.gs`](apps-script/Code.gs) in the **supajuice/feedback** repo on GitHub, press **Copy raw file**, and paste it in.
5. Press **Save** (the floppy disk icon). The orange dot next to `Code.gs` disappears.

## 3. Connect it to the order Sheet (read only)

1. Open the **order Sheet** in another tab, click the address bar and copy the whole address.
2. Back in the feedback script, click the **gear** on the left (**Project Settings**), scroll to **Script Properties** and click **Add script property**.
3. Property: `ORDER_SHEET_ID`. Value: paste the address. Click **Save script properties**.
4. Click **< >** on the left to go back to the code.

## 4. Run setup

1. In the drop-down above the code choose **setup**, then click **Run**.
2. Allow the permissions:
   - **Review permissions** > choose the shop account;
   - on **Google hasn't verified this app**, click **Advanced**, then **Go to Supa Juice Feedback (unsafe)**;
   - **Allow**.

   It asks to see and edit your spreadsheets: it writes the Feedback Sheet and only reads the order Sheet.
3. The log at the bottom should end with **"Buyer check: connected to the order Sheet."**
4. Optional: run **checkOrders**. It logs how many rows it can see in the order Sheet.

If the browser tab with the Sheet was open while setup ran, reload it. You'll see the **Reviews** and **Suggestions** tabs.

## 5. Publish it

1. Click **Deploy > New deployment**, the **gear** next to *Select type*, then **Web app**.
2. **Execute as: Me**, **Who has access: Anyone**. Click **Deploy** and allow again if asked.

   "Anyone" only means the page can reach it. It can only add reviews and suggestions: it never shows anyone what's in the Sheet.
3. Copy the **Web app URL** (it ends in `/exec`). Open it in a new tab: it should show `{"ok":true,"service":"feedback"}`.
4. Send the address to Vishwesh. It goes in [`docs/config.js`](docs/config.js) as `endpoint`. Until it's there, the page only says thank you and sends nothing.

When `Code.gs` changes later: paste the new code, **Save**, then **Deploy > Manage deployments > pencil > Version: New version > Deploy**. Don't use *New deployment*, which makes a new address.

## Reading the Sheet

**Reviews**

| Column | What it means |
|---|---|
| Received | When it came in (Cape Town time) |
| Stars, Flavour, Used for, Review | What they wrote. Flavour, Used for and Review can be empty |
| Name, Email | Name is optional. The email is the one they say they ordered with |
| May post | **yes**: they agreed to their stars and words being shown on the website, without their name or email. **no**: keep it private |
| Verified buyer | **yes**: the email has a paid or delivered order (see Invoice). **no**: no such order. **not checked**: the order Sheet couldn't be read when it came in |
| Invoice | Their newest paid or delivered order |
| Show on site | Empty. For later: Greg types **yes** for reviews to show on the website. Only reviews with **May post: yes** and **Verified buyer: yes** should ever get a yes |

**Suggestions**: Received, Topic, Idea, and Name and Email when they gave them.

The page never tells the person whether their email was found, so nobody can use it to check who has ordered.

## Privacy (POPIA)

- The form says why it asks for the email (to check they bought), and promises no spam. Keep to that: don't add these emails to marketing lists.
- The Sheet is private to the shop account. Don't share it publicly.
- If someone asks to be removed, delete their rows.
- A review is only ever shown with **May post: yes**, and then only the stars and words, never the name or email.

## Limits

- At most 30 reviews and suggestions an hour in total, so a bot can't flood the Sheet. After that people see "Lots of people are writing in right now. Please try again a bit later."
- A hidden field catches most bots: they get a thank-you and nothing is saved.
