# EmailBison Dedicated API Reference

Base URL: `https://dedi.emailbison.com`

## Account Management

This section handles operations related to user accounts within the application.
It includes endpoints for user registration, profile management and password reset.

### `GET /api/users`

**Account Details**

This endpoint retrieves the details of the authenticated user.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/users/profile-picture`

**Update Profile Picture**

This endpoint allows the authenticated user to update their profile information, specifically their profile picture.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`multipart/form-data`):
- `photo` (string) *required* — The new profile picture to update. Must be a valid image file (jpg, jpeg or png) and no larger than 1MB.

---

### `PUT /api/users/password`

**Update Password**

This endpoint allows the authenticated user to update their password.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `current_password` (string) *required* — Your current password.
- `password` (string) *required* — Your new password.
- `password_confirmation` (string) *required* — Your new password repeated.

---

### `POST /api/users/headless-ui-token`

**Generate headless UI token (beta)**

This endpoint allows the authenticated workspace user to generate a headless UI token that's valid
for up to **120 minutes**. The main purpose of this token is to let partner apps generate an embedded email
account connection view without having to build all the UIs and OAuth connection flows themselves.

Multiple tokens can be active at a given time, but they will all expire after **120 minutes**.

`Note:` You must get your requesting URL whitelisted before embedding the iframe in
your app.

The user must provide a valid authentication token in the request header to access this endpoint.

Once a token is generated, you can open an Iframe with the following URL format: https://your-bison-url.com/headless-ui-login?token=YOUR_HEADLESS_UI_TOKEN

This will then open an app window without the navigation bar and breadcrumbs. For now, this is only recommended
for enabling email account connection flows for OAuth.

---

## Campaigns

This section provides endpoints to manage campaign-related operations.

### `GET /api/campaigns`

**List campaigns**

This endpoint retrieves all of the authenticated user's campaigns.

Search, tags, and status are all optional parameters.

**Request Body** (`application/json`):
- `search` (string)
- `status` (string)
- `tag_ids` (array) — The <code>id</code> of an existing record in the tags table.

---

### `POST /api/campaigns`

**Create a campaign**

This endpoint allows the authenticated user to create a new campaign.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the new campaign.
- `type` (string) — optional The type of campaign. Default is `outbound`

---

### `POST /api/campaigns/{campaign_id}/duplicate`

**Duplicate campaign**

This endpoint allows the authenticated user to duplicate a campaign.

---

### `PATCH /api/campaigns/{campaign_id}/pause`

**Pause campaign**

This endpoint allows the authenticated user to pause a campaign.

---

### `PATCH /api/campaigns/{campaign_id}/resume`

**Resume campaign**

This endpoint allows the authenticated user to resume a paused campaign.

---

### `PATCH /api/campaigns/{campaign_id}/archive`

**Archive campaign**

This endpoint allows the authenticated user to archive a campaign.

---

### `PATCH /api/campaigns/{id}/update`

**Update campaign settings**

This endpoint allows the authenticated user to update the settings of a campaign.

**Request Body** (`application/json`):
- `name` (string) — The name of the campaign.
- `max_emails_per_day` (integer) — The maximum number of emails that can be sent per day.
- `max_new_leads_per_day` (integer) — The maximum number of new leads that can be added per day.
- `plain_text` (boolean) — Whether the email content should be plain text. If nothing sent, false is assumed.
- `open_tracking` (boolean) — Whether open tracking should be enabled for the campaign. If nothing sent, false is assumed.
- `reputation_building` (boolean) — Spam protection. If nothing sent, false is assumed.
- `can_unsubscribe` (boolean) — Whether recipients can unsubscribe from the campaign using a one-click link. If nothing sent, false is assumed.
- `include_auto_replies_in_stats` (boolean) — If auto replies should be included in the campaign stats. This setting is not retroactive.
- `sequence_prioritization` (string) — How the campaign sequence should be prioritized. By default, followups are prioritized.

---

### `POST /api/campaigns/{campaign_id}/schedule`

**Create campaign schedule**

This endpoint allows the authenticated user to create the schedule of the campaign.

**Request Body** (`application/json`):
- `monday` (boolean) *required* — Whether the schedule includes Monday.
- `tuesday` (boolean) *required* — Whether the schedule includes Tuesday.
- `wednesday` (boolean) *required* — Whether the schedule includes Wednesday.
- `thursday` (boolean) *required* — Whether the schedule includes Thursday.
- `friday` (boolean) *required* — Whether the schedule includes Friday.
- `saturday` (boolean) *required* — Whether the schedule includes Saturday.
- `sunday` (boolean) *required* — Whether the schedule includes Sunday.
- `start_time` (string) *required* — The start time in HH:MM format.
- `end_time` (string) *required* — The end time in HH:MM format.
- `timezone` (string) *required* — The timezone of the schedule.
- `save_as_template` (boolean) — Wheter the created schedule should be saved as template.

---

### `GET /api/campaigns/{campaign_id}/schedule`

**View campaign schedule**

This endpoint allows the authenticated user to view the schedule of the campaign.

---

### `PUT /api/campaigns/{campaign_id}/schedule`

**Update campaign schedule**

This endpoint allows the authenticated user to update the schedule of the campaign.

**Request Body** (`application/json`):
- `monday` (boolean) *required* — Whether the schedule includes Monday.
- `tuesday` (boolean) *required* — Whether the schedule includes Tuesday.
- `wednesday` (boolean) *required* — Whether the schedule includes Wednesday.
- `thursday` (boolean) *required* — Whether the schedule includes Thursday.
- `friday` (boolean) *required* — Whether the schedule includes Friday.
- `saturday` (boolean) *required* — Whether the schedule includes Saturday.
- `sunday` (boolean) *required* — Whether the schedule includes Sunday.
- `start_time` (string) *required* — The start time in HH:MM format.
- `end_time` (string) *required* — The end time in HH:MM format.
- `timezone` (string) *required* — The timezone of the schedule.
- `save_as_template` (boolean) *required*

---

### `GET /api/campaigns/schedule/templates`

**View all schedule templates**

This endpoint allows the authenticated user to view their scheduled templates.

---

### `GET /api/campaigns/schedule/available-timezones`

**View all available schedule timezones**

This endpoint allows the authenticated user to view all available timezones.
You must use an ID from this list whenever you're working on Campaign Schedules

---

### `GET /api/campaigns/sending-schedules`

**Show sending schedules for campaigns**

This endpoint allows the authenticated user to view the sending schedules for campaigns

**Request Body** (`application/json`):
- `day` (string) *required* — The day of the schedule.

---

### `GET /api/campaigns/{campaign_id}/sending-schedule`

**Show sending schedule for campaign**

This endpoint allows the authenticated user to view the sending schedule of a single campaign

**Request Body** (`application/json`):
- `day` (string) *required* — The day of the schedule.

---

### `POST /api/campaigns/{campaign_id}/create-schedule-from-template`

**Create campaign schedule from template**

This endpoint allows the authenticated user to create the schedule of the campaign.

**Request Body** (`application/json`):
- `schedule_id` (integer) *required* — The ID of the schedule template.

---

### `GET /api/campaigns/{campaign_id}/sequence-steps`

**View campaign sequence steps (deprecated)**

This endpoint allows the authenticated user to view the sequence steps of the campaign.

---

### `POST /api/campaigns/{campaign_id}/sequence-steps`

**Create sequence steps (deprecated)**

This endpoint allows the authenticated user to create the campaign sequence steps from scratch.

**Request Body** (`application/json`):
- `title` (string) *required* — The title for the sequence.
- `sequence_steps` (array) *required* — The array containing the sequence steps

---

### `PUT /api/campaigns/sequence-steps/{sequence_id}`

**Update sequence steps (deprecated)**

This endpoint allows the authenticated user to update the campaign sequence steps.

**Request Body** (`application/json`):
- `title` (string) *required* — The title for the sequence.
- `sequence_steps` (array) *required* — The array containing the sequence steps

---

### `PATCH /api/campaigns/sequence-steps/{sequence_step_id}/activate-or-deactivate`

**Activate or deactivate a sequence step variant**

This endpoint allows the authenticated user to activate or deactivate a sequence step variant.

You can get a list of sequence step IDs by making a request to `/campaigns/v1.1/{campaign_id}/sequence-steps`.

**Request Body** (`application/json`):
- `active` (boolean) — Whether the variant should be active.

---

### `DELETE /api/campaigns/sequence-steps/{sequence_step_id}`

**Delete sequence step**

This endpoint allows the authenticated user to delete a specific sequence step from a sequence

---

### `POST /api/campaigns/sequence-steps/{sequence_step_id}/test-email`

**Send sequence step test email**

This endpoint allows the authenticated user to send a test email from a sequence step. You need at least
one lead in the campaign to send a test email.

**Request Body** (`application/json`):
- `sender_email_id` (integer) *required* — The ID of the sender email to send from.
- `to_email` (string) *required* — The email address to send the sequence step to.
- `use_dedicated_ips` (boolean) — Send using the dedicated campaign IPs instead of the instance IP

---

### `GET /api/campaigns/{campaign_id}/replies`

**Get campaign replies**

This endpoint retrieves all replies associated with a campaign.

**Parameters:**
- `search` (query) — Search term for filtering replies.
- `status` (query) — Filter by status. One of `interested`, `automated_reply`, `not_automated_reply`.
- `folder` (query) — Filter by folder. One of `inbox`, `sent`, `spam`, `bounced`, `all`.
- `read` (query) — Filter by read status.
- `sender_email_id` (query) — The ID of the sender email address.
- `lead_id` (query) — The <code>id</code> of an existing record in the leads table.
- `tag_ids` (query) — Array of tag IDs to filter by.
- `campaign_id` (query) — The ID of the campaign.

---

### `GET /api/campaigns/{campaign_id}/leads`

**Get all leads for campaign**

This endpoint retrieves all leads associated with a campaign.

**Parameters:**
- `search` (query) — Search term for filtering replies.
- `filters` (query)
- `filters.lead_campaign_status` (query) — Filter by lead campaign status. One of `in_sequence`, `sequence_finished`, `sequence_stopped`, `never_contacted`, `replied`.
- `filters.emails_sent` (query) — Filter by the number of emails sent.
- `filters.emails_sent.criteria` (query) — Comparison operator for emails sent. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.emails_sent.value` (query) — Value for the number of emails sent.
- `filters.opens` (query)
- `filters.opens.criteria` (query) — Comparison operator for email opens. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.opens.value` (query) — Value for the number of email opens.
- `filters.replies` (query)
- `filters.replies.criteria` (query) — Comparison operator for replies. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.replies.value` (query) — Value for the number of replies.
- `filters.verification_statuses` (query) — A verification status. Accepted values: `verifying`, `verified`, `risky`, `unknown`, `unverified`, `inactive`, `bounced`, `unsubscribed`
- `filters.tag_ids` (query) — Filter by tag IDs.
- `filters.excluded_tag_ids` (query) — Exclude leads by tag IDs.
- `filters.without_tags` (query) — Only show leads that have no tags attached.
- `filters.created_at.criteria` (query) — Comparison operator for the created_at date. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.created_at.value` (query) — Value for the created_at date. Must be a valid date in YYYY-MM-DD format.
- `filters.updated_at.criteria` (query) — Comparison operator for the updated_at date. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.updated_at.value` (query) — Value for the updated_at date. Must be a valid date in YYYY-MM-DD format.

---

### `DELETE /api/campaigns/{campaign_id}/leads`

**Remove leads from a campaign**

This endpoint allows the authenticated user to remove leads from a campaign.

**Hold on. You may not need to remove leads!**
Please read carefully before attempting to delete.

**I mapped the wrong custom variables for these leads**
No problem! Simply re-upload the leads and we'll update the records in place. This is especially useful if you already have lead history like conversations, campaigns, etc.

**I don't to email these leads in this campaign anymore**
You can simply click "stop future emails" instead.

If you want to stop them from being emailed in any campaign, we recommend unsubscribing these leads instead. Bulk select -> Update Status -> Unsubscribe. This way, you can preserve the lead history and stats for future reports.

**I want to update these leads with more data**
Instead of deleting, simply re-upload the leads. We'll update the records in place. This includes all campaign emails too. If you delete, their history in this campaign will be reset.

**If you still want to remove them from the campaign, please read carefully below.**

**All future scheduled emails in this campaign will be stopped (for these leads)**
Your leads will no longer receive future emails from this campaign

**Existing campaign stats (for these leads) will be retained**
You will still be able to pull data from this campaign for all past stats (eg. emails sent, replies received, etc.)

**Lead conversations will remain**
You will still be able continue lead conversations through the master inbox

**These leads will no longer be accessible via API (for this campaign)**
You will be responsible for your automations if you rely on cached or self-stored values for these leads

**Future replies for these leads will not increment stats**
**If you emailed these leads and they respond in the future after being removed, stats will not be incremented**

**This action is permanent and cannot be reversed**
If you removed these leads by accident and try to re-add them, the history will be totally reset. This action is permanent.

**Request Body** (`application/json`):
- `lead_ids` (array) *required* — An array of lead IDs to remove.

---

### `POST /api/campaigns/{campaign_id}/leads/attach-lead-list`

**Import leads from existing list**

This endpoint allows the authenticated user to import leads from an existing list into a campaign.

**Request Body** (`application/json`):
- `allow_parallel_sending` (boolean) — Force add leads that are "In Sequence" in other campaigns.
- `lead_list_id` (integer) *required* — The ID of the lead list to import.

---

### `POST /api/campaigns/{campaign_id}/leads/attach-leads`

**Import leads by IDs**

This endpoint allows the authenticated user to import leads by their IDs into a campaign.

If you are adding leads to an active campaign, we cache them locally, and then sync every
5 minutes to ensure there is no interruption to your sending.

**Important:** If you add leads into a "reply followup campaign" using this endpoint, we
will just start the conversation from **the last sent reply**. We recommend that you use
the more explicit `/replies/id/followup-campaign/push` endpoint to control exactly which
conversation you want to follow up on.

**Request Body** (`application/json`):
- `allow_parallel_sending` (boolean) — Force add leads that are "In Sequence" in other campaigns.
- `lead_ids` (array) *required* — An array of lead IDs to import.

---

### `POST /api/campaigns/{campaign_id}/leads/stop-future-emails`

**Stop future emails for leads**

This endpoint allows the authenticated user to stop future emails for selected leads in a campaign

**Request Body** (`application/json`):
- `lead_ids` (array) *required* — An array of lead IDs to stop future emails for.

---

### `GET /api/campaigns/{campaign_id}/scheduled-emails`

**Get all scheduled emails for campaign**

This endpoint retrieves all scheduled emails associated with a campaign.

**Request Body** (`application/json`):
- `status` (string)
- `scheduled_date` (string) — Must be a valid date.
- `scheduled_date_local` (string) — Must be a valid date.

---

### `GET /api/campaigns/{campaign_id}/sender-emails`

**Get all campaign sender emails**

This endpoint retrieves all email accounts (sender emails) associated with a campaign

---

### `POST /api/campaigns/{campaign_id}/stats`

**Get campaign stats (summary)**

This endpoint retrieves the statistics of all your campaigns.

**Request Body** (`application/json`):
- `start_date` (string) *required* — The start date to fetch stats.
- `end_date` (string) *required* — The end date to fetch stats.

---

### `POST /api/campaigns/{campaign_id}/attach-sender-emails`

**Import sender emails by ID**

This endpoint allows the authenticated user to attach sender emails to a campaign.

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — An array of sender emails IDs to attach.

---

### `DELETE /api/campaigns/{campaign_id}/remove-sender-emails`

**Remove sender emails by ID**

This endpoint allows the authenticated user to remove sender emails from a draft or paused campaign.

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — An array of sender emails IDs to attach.

---

### `POST /api/campaigns/{campaign_id}/leads/move-to-another-campaign`

**Move leads to another campaign**

This endpoint moves selected leads from a campaign to a selected target campaign.
This process may take a few minutes if the campaigns are active.

**Request Body** (`application/json`):
- `target_campaign_id` (integer) *required* — The ID of the campaign that leads will be moved to.
- `lead_ids` (array) *required* — The array of lead IDs.
- `include_bounced_and_unsubscribed` (boolean) — Whether to include bounced and unsubscribed leads.

---

### `GET /api/campaigns/{campaign_id}/line-area-chart-stats`

**Get full normalized stats by date**

This endpoint retrieves stats by date for a given period, for this campaign

The user must provide a valid authentication token in the request header to access this endpoint.

Events returned: `Replied`, `Total Opens`, `Unique Opens`, `Sent`, `Bounced`, `Unsubscribed`, `Interested`

**Parameters:**
- `start_date` (query) *required* — The start date to fetch stats.
- `end_date` (query) *required* — The end date to fetch stats.

---

### `GET /api/campaigns/{id}`

**Campaign details**

This endpoint retrieves the details of a specific campaign.

---

### `DELETE /api/campaigns/bulk`

**Bulk delete campaigns by ID**

This endpoint allows the authenticated user to bulk delete campaigns.
Campaign deletion is queued up and processed in the background.

*Overall stats and lead conversations will not be affected**
 You will still be able to take part in conversations from leads from these campaigns, in the master inbox.

 **Your campaigns will no longer be accessible via API**
 You may have automations with hard-coded campaign IDs that may no longer work. Please ensure that you only poll for campaigns that exist.

 **Future responses for these campaigns will still be captured**
 We will still main a link to this campaign for any future received responses, but there will be no stat increments.

 **This action is permanent and cannot be reversed**
 Please only delete campaigns if you are sure you never want to see them again. Once deleted, they can no longer be recovered.

**Request Body** (`application/json`):
- `campaign_ids` (array) — Array of campaign IDs

---

### `DELETE /api/campaigns/{campaign_id}`

**Delete a campaign**

This endpoint allows the authenticated user to delete a campaign.
Campaign deletion is queued up and processed in the background.

**Overall stats and lead conversations will not be affected**
You will still be able to take part in conversations from leads from these campaigns, in the master inbox.

**Your campaigns will no longer be accessible via API**
You may have automations with hard-coded campaign IDs that may no longer work. Please ensure that you only poll for campaigns that exist.

**Future responses for these campaigns will still be captured**
We will still main a link to this campaign for any future received responses, but there will be no stat increments.

**This action is permanent and cannot be reversed**
Please only delete campaigns if you are sure you never want to see them again. Once deleted, they can no longer be recovered.

---

## Replies

This section provides endpoints to manage replies.
It includes functionalities for retrieving, updating, and managing replies.

### `GET /api/replies`

**Get all replies**

This endpoint retrieves all replies for the authenticated user.

The user must provide a valid authentication token in the request header to access this endpoint.

**Parameters:**
- `search` (query) — Search term for filtering replies.
- `status` (query) — Filter by status. One of `interested`, `automated_reply`, `not_automated_reply`.
- `folder` (query) — Filter by folder. One of `inbox`, `sent`, `spam`, `bounced`, `all`.
- `read` (query) — Filter by read status.
- `campaign_id` (query) — The ID of the campaign.
- `sender_email_id` (query) — The ID of the sender email address.
- `lead_id` (query) — The <code>id</code> of an existing record in the leads table.
- `tag_ids` (query) — Array of tag IDs to filter by.

---

### `GET /api/replies/{id}`

**Get reply**

This endpoint retrieves a specific reply by its ID.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/replies/new`

**Compose new email**

This endpoint allows you to send a one-off email in a new email thread

The user must provide a valid authentication token in the request header to access this endpoint.

Please note that if you are sending an array of file attachments, your request must include
a header of "Content-Type": "multipart/form-data". Otherwise your file attachments will not be processed.

**Request Body** (`application/json`):
- `subject` (string) — The subject of the email
- `message` (string) — The contents of the reply
- `sender_email_id` (integer) *required* — The <code>id</code> of an existing record in the sender_emails table.
- `use_dedicated_ips` (boolean) — Send using the dedicated campaign IPs instead of the instance IP
- `content_type` (string) — Type of the email (html or text)
- `to_emails` (array) — Array of people to send this email to.
- `cc_emails` (array)
- `bcc_emails` (array)
- `attachments` (array) — optional Array of multi-part files that you want to attach. Combined max size: 25MB, individual max size: 10MB.

---

### `POST /api/replies/{reply_id}/reply`

**Create new reply**

This endpoint allows you to reply to an existing email.

The user must provide a valid authentication token in the request header to access this endpoint.

Please note that if you are sending an array of file attachments, your request must include
a header of "Content-Type": "multipart/form-data". Otherwise your file attachments will not be processed.

**Request Body** (`application/json`):
- `reply_all` (boolean) — If set to true, automatically choose the correct sender email, and add the recipients from the original reply. Explicitly passing in `sender_email_id` will overwrite the chosen sender email, and recipients passed in `to_emails` or "cc_emails" will be appended.
- `inject_previous_email_body` (boolean) — Whether to inject the body of the previous email into this email
- `message` (required) — string The contents of the reply
- `reply_template_id` (optional) — int The reply template ID that you want to use for this reply.
- `use_dedicated_ips` (boolean) — Send using the dedicated campaign IPs instead of the instance IP
- `sender_email_id` (required) — integer The ID of the sender email. Not required if `reply_all` is set to true. If `reply_all` is set to true and this parameter is passed, this parameter takes priority.
- `content_type` (string) — Type of the email (html or text)
- `to_emails` (array) *required* — Array of people to send this email to. Not required if `reply_all` is set to true. If `reply_all` is set to true and this parameter is passed, the recipients will be appended. Duplicate recipients are ignored.
- `cc_emails` (array) — An array of people to send a copy of this email to (Carbon Copy). If `reply_all` is set to true and this parameter is passed, the recipients will be appended. Duplicate recipients are ignored.
- `bcc_emails` (array) — An array of people to send a blind copy of this email to (Blind Carbon Copy).
- `attachments` (array) — optional Array of multi-part files that you want to attach. Combined max size: 25MB, individual max size: 10MB.

---

### `POST /api/replies/{reply_id}/forward`

**Forward reply**

This endpoint allows you to forward an existing reply.

The user must provide a valid authentication token in the request header to access this endpoint.

 Please note that if you are sending an array of file attachments, your request must include
 a header of "Content-Type": "multipart/form-data". Otherwise your file attachments will not be processed.

**Request Body** (`application/json`):
- `reply_all` (boolean)
- `inject_previous_email_body` (boolean) — Whether to inject the body of the previous email into this email
- `message` (string) — The contents of the reply
- `reply_template_id` (optional) — int The reply template ID that you want to use for this reply.
- `use_dedicated_ips` (boolean) — Send using the dedicated campaign IPs instead of the instance IP
- `sender_email_id` (integer) — This field is required unless <code>reply_all</code> is in <code>true</code>. The <code>id</code> of an existing record in the sender_emails table.
- `content_type` (string) — Type of the email (html or text)
- `to_emails` (array) — Array of people to send this email to.
- `cc_emails` (array)
- `bcc_emails` (array)
- `attachments` (array) — optional Array of multi-part files that you want to attach. Combined max size: 25MB, individual max size: 10MB.

---

### `PATCH /api/replies/{reply_id}/mark-as-interested`

**Mark as interested**

This endpoint marks a specific reply as interested. If a particular lead is
already marked as "interested" within a campaign, no changes will be made.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `PATCH /api/replies/{reply_id}/mark-as-not-interested`

**Mark as not interested**

This endpoint marks a specific reply as not interested.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `PATCH /api/replies/{reply_id}/mark-as-read-or-unread`

**Mark as read or unread**

This endpoint marks a specific reply as read or unread.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `read` (boolean) *required* — Whether to set mark the reply as read or unread.

---

### `PATCH /api/replies/{reply_id}/mark-as-automated-or-not-automated`

**Mark as automated or not automated**

This endpoint marks a specific reply as automated or not automated.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `automated` (boolean) *required* — Whether to mark the reply as automated or not automated.

---

### `PATCH /api/replies/{reply_id}/unsubscribe`

**Unsubscribe contact that replied**

This endpoint unsubscribes the contact associated with a specific reply from scheduled emails.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `DELETE /api/replies/{reply_id}`

**Delete reply**

This endpoint deletes a specific reply by its ID.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `GET /api/replies/{reply_id}/conversation-thread`

**Get reply conversation thread**

This endpoint gets you a reply object with all previous and newer messages to build out an email thread

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/replies/{reply_id}/attach-scheduled-email-to-reply`

**Attach scheduled email to reply**

This endpoint attaches a scheduled email to a reply (and lead). You can use this for untracked replies where
headers may have been missing when the email was received. This will take care of incrementing all stats too.

**Request Body** (`application/json`):
- `scheduled_email_id` (integer) *required* — The ID of the scheduled email.

---

### `POST /api/replies/{reply_id}/followup-campaign/push`

**Push reply (and lead) to "reply followup campaign"**

This endpoint lets you push a reply to a "reply followup campaign"
The goal is to followup with interested leads in a templated, automated manner.
Followups are done in the same conversation thread, and we take the last message from the
conversation to continue the process.

Caveats: the reply must have a sender email attached. If you deleted a sender email, then you
will need to add this lead into a separate outbound campaign since we cannot send an email in the same thread.

**Request Body** (`application/json`):
- `campaign_id` (integer) *required* — The ID of the followup campaign
- `force_add_reply` (boolean) — optional Set this to true if you want to ignore the lead's unsubscribed or bounced status

---

## Email Accounts

This section provides endpoints to manage email accounts associated with a workspace.
It includes functionalities for listing all email accounts, retrieving details of a specific email account,
creating new IMAP/SMTP email accounts, testing IMAP and SMTP connections, and deleting existing email accounts.

### `GET /api/sender-emails`

**List email accounts**

Retrieves a collection of email accounts associated with the authenticated workspace.

**Parameters:**
- `search` (query) — Search term for filter by.
- `tag_ids` (query) — Array of tag IDs to filter by.
- `excluded_tag_ids` (query) — Exclude email accounts by tag IDs.
- `without_tags` (query) — Only show email accounts that have no tags attached.
- `status` (query) — The status of the email account.

---

### `GET /api/sender-emails/{senderEmailId}/campaigns`

**Show Email Account Campaigns**

Retrieves a collection of campaigns where this email account is being used

---

### `GET /api/sender-emails/{senderEmailId}`

**Show email account details**

Retrieves details of a specific email account.

---

### `PATCH /api/sender-emails/{senderEmailId}`

**Update sender email**

Update the settings for a specified sender email.

**Request Body** (`application/json`):
- `daily_limit` (integer) — The daily limit of emails that can be sent from this sender email.
- `name` (string) — The name of the sender email.
- `email_signature` (string) — The HTML signature of the sender email.

---

### `DELETE /api/sender-emails/{senderEmailId}`

**Delete email account**

Add multiple sender email addresses at once.

---

### `GET /api/sender-emails/{senderEmailId}/replies`

**Get email account replies**

This endpoint retrieves all replies associated with a given email account

**Parameters:**
- `search` (query) — Search term for filtering replies.
- `status` (query) — Filter by status. One of `interested`, `automated_reply`, `not_automated_reply`.
- `folder` (query) — Filter by folder. One of `inbox`, `sent`, `spam`, `bounced`, `all`.
- `read` (query) — Filter by read status.
- `campaign_id` (query) — The ID of the campaign.
- `lead_id` (query) — The <code>id</code> of an existing record in the leads table.
- `tag_ids` (query) — Array of tag IDs to filter by.
- `sender_email_id` (query) — The ID of the sender email address.

---

### `GET /api/sender-emails/{senderEmailId}/oauth-access-token`

**Get email account oAuth access token**

This endpoint retrieves the OAuth access token for a sender email account (Google or Microsoft accounts only).

If a token has expired, a new one is automatically retrieved and returned using the saved refresh token.

---

### `PATCH /api/sender-emails/signatures/bulk`

**Bulk update email signatures**

Update the signatures of multiple sender emails at once.

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — An array of sender email IDs to update signatures for.
- `email_signature` (string) *required* — The HTML signature to use.

---

### `PATCH /api/sender-emails/daily-limits/bulk`

**Bulk update email daily limits**

Update the daily sending limit of multiple sender emails at once.

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — An array of sender email IDs to update daily limits for.
- `daily_limit` (integer) *required* — The daily sending limit to set.

---

### `POST /api/sender-emails/imap-smtp`

**Create IMAP/SMTP Email Account**

Creates a new IMAP/SMTP email account for the authenticated workspace.

**Request Body** (`application/json`):
- `name` (string) *required* — The name associated with the sender email.
- `email` (string) *required* — The email address of the sender. Must be unique and in a valid email format.
- `password` (string) *required* — The password for the sender email.
- `imap_server` (string) *required* — The IMAP server address for the sender email. Must be a valid domain name.
- `imap_port` (integer) *required* — The IMAP server port for the sender email.
- `smtp_server` (string) *required* — The SMTP server address for the sender email. Must be a valid domain name.
- `smtp_port` (integer) *required* — The SMTP server port for the sender email.
- `smtp_secure` (boolean)
- `imap_secure` (boolean)
- `email_signature` (string) — The signature for the sender email.

---

### `POST /api/sender-emails/bulk`

**Bulk add sender emails**

Add multiple sender email addresses at once.

**Request Body** (`multipart/form-data`):
- `csv` (string) *required* — The CSV file containing the contacts.

---

### `POST /api/sender-emails/{senderEmailId}/check-mx-records`

**Check MX records**

Checks the email host for a given email address and returns the host + all MX records.
Results are not cached, and if a valid return is returned, the Sender Email account will be updated.

---

### `POST /api/sender-emails/bulk-check-missing-mx-records`

**Bulk check missing MX records**

This endpoint lets you trigger a job that will bulk check all email accounts with
missing MX records in the given workspace.

---

## Email Blacklist

APIs for managing blacklisted emails. This includes retrieving, creating,
bulk creating, and removing blacklisted emails.

### `GET /api/blacklisted-emails`

**Get all blacklisted emails**

Retrieve a list of all blacklisted emails for the authenticated user.

---

### `POST /api/blacklisted-emails`

**Create blacklisted email**

Add a new email to the blacklist.

**Request Body** (`application/json`):
- `email` (string) *required* — The email address to be blacklisted.

---

### `GET /api/blacklisted-emails/{blacklisted_email_id}`

**Get blacklisted email**

Get a single blacklisted email by email or ID.

---

### `DELETE /api/blacklisted-emails/{blacklisted_email_id}`

**Remove blacklisted email**

Remove an email from the blacklist.

---

### `POST /api/blacklisted-emails/bulk`

**Bulk create blacklisted emails**

Add multiple emails to the blacklist in a single request.

**Request Body** (`multipart/form-data`):
- `csv` (string) *required* — The CSV file containing the blacklisted emails.

---

## Domain Blacklist

APIs for managing blacklisted domains. This includes retrieving, creating,
bulk creating, and removing blacklisted domains.

### `GET /api/blacklisted-domains`

**Get all blacklisted domains**

Retrieve a list of all blacklisted domains for the authenticated user.

---

### `POST /api/blacklisted-domains`

**Create blacklisted domain**

Add a new domain to the blacklist.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to be blacklisted.

---

### `GET /api/blacklisted-domains/{blacklisted_domain_id}`

**Get blacklisted domain**

Get a single blacklisted domain by domain or ID.

---

### `DELETE /api/blacklisted-domains/{blacklisted_domain_id}`

**Remove blacklisted domain**

Remove a domain from the blacklist.

---

### `POST /api/blacklisted-domains/bulk`

**Bulk create blacklisted domains**

Add multiple domains to the blacklist in a single request.

**Request Body** (`multipart/form-data`):
- `csv` (string) *required* — The CSV file containing the blacklisted emails.

---

## Custom Tags

APIs for managing tags. This includes creating, retrieving, attaching to leads,
and removing tags from leads.

### `GET /api/tags`

**Get all tags for workspace**

Retrieve a list of all tags for the authenticated user's workspace.

---

### `POST /api/tags`

**Create tag**

Add a new tag.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the tag.

---

### `GET /api/tags/{id}`

**View tag**

View a saved tag.

---

### `DELETE /api/tags/{tag_id}`

**Remove tag**

Delete a tag.

---

### `POST /api/tags/attach-to-campaigns`

**Attach tags to campaigns**

Attach multiple tags to campaigns.

**Request Body** (`application/json`):
- `tag_ids` (array) *required* — An array of tag IDs to be attached.
- `campaign_ids` (array) *required* — An array of campaign IDs to which the tags will be attached.
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `POST /api/tags/remove-from-campaigns`

**Remove tags from campaigns**

Detach multiple tags from campaigns.

**Request Body** (`application/json`):
- `tag_ids` (array) *required* — An array of tag IDs to be detached.
- `campaign_ids` (array) *required* — An array of campaign IDs from which the tags will be detached.
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `POST /api/tags/attach-to-leads`

**Attach tags to leads**

Attach multiple tags to leads.

**Request Body** (`application/json`):
- `tag_ids` (array) *required* — An array of tag IDs to be attached.
- `lead_ids` (array) *required* — An array of lead IDs to which the tags will be attached.
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `POST /api/tags/remove-from-leads`

**Remove tags from leads**

Detach multiple tags from leads.

**Request Body** (`application/json`):
- `tag_ids` (array) *required* — An array of tag IDs to be detached.
- `lead_ids` (array) *required* — An array of lead IDs from which the tags will be detached.
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `POST /api/tags/attach-to-sender-emails`

**Attach tags to email accounts**

Attach multiple tags to email accounts

**Request Body** (`application/json`):
- `tag_ids` (array) *required* — An array of tag IDs to be attached.
- `sender_email_ids` (array) *required* — An array of email account IDs to which the tags will be attached.
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

### `POST /api/tags/remove-from-sender-emails`

**Remove tags from email accounts**

Detach multiple tags from email accounts

**Request Body** (`application/json`):
- `tag_ids` (array) *required* — An array of tag IDs to be detached.
- `sender_email_ids` (array) *required* — An array of email account IDs from which the tags will be detached.
- `skip_webhooks` (boolean) — If set to true, no webhooks will be fired for this action.

---

## Custom Tracking Domains

APIs for managing custom tracking domains. This includes retrieving, creating,
and removing custom tracking domains.

### `GET /api/custom-tracking-domain`

**Get all custom tracking domains**

Retrieve a list of all custom tracking domains for the authenticated user.

---

### `POST /api/custom-tracking-domain`

**Create custom tracking domain**

Add a new custom tracking domain to the authenticated user's team.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain name to be added.

---

### `GET /api/custom-tracking-domain/{id}`

**Get a custom tracking domains**

View a custom tracking domains.

---

### `DELETE /api/custom-tracking-domain/{custom_tracking_domain_id}`

**Remove custom tracking domain**

Delete a custom tracking domain.

---

## Webhooks

APIs for managing webhooks. This includes listing, creating, retrieving and deleting webhook urls.

### `GET /api/webhook-url`

**Get all webhooks**

Retrieve a list of all webhooks for the authenticated user's workspace.

---

### `POST /api/webhook-url`

**Create a new webhook**

Store a new webhook for the authenticated user's workspace. Provide an array of events to associate with the webhook; the events included in the array will be enabled.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the webhook.
- `url` (string) *required* — The URL to send data to.
- `events` (array) *required* — The events to subscribe to.

---

### `GET /api/webhook-url/{id}`

**Get a single webhook**

Get the details of a specific webhook.

---

### `PUT /api/webhook-url/{id}`

**Update a webhook**

Modify an existing webhook's details. Send an array of events to modify the webhook; the events included will be enabled, and those not included will be disabled.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the webhook.
- `url` (string) *required* — The URL to send data to.
- `events` (array) *required* — The events to subscribe to.

---

### `DELETE /api/webhook-url/{webhook_url_id}`

**Delete a webhook**

Remove a webhook url by its ID.

---

## Campaign Events

Drill down into campaign event stats based on dates, campaign IDs, and/or sender email IDs

### `GET /api/campaign-events/stats`

**Breakdown of events by date**

This endpoint retrieves stats by date for a given period, for this campaign

Drill down into campaign event stats based on dates, campaign IDs, and/or sender email IDs

The user must provide a valid authentication token in the request header to access this endpoint.

Events returned: `Replied`, `Total Opens`, `Unique Opens`, `Sent`, `Bounced`, `Unsubscribed`, `Interested`

**Parameters:**
- `start_date` (query) *required* — The start date to fetch stats.
- `end_date` (query) *required* — The end date to fetch stats.
- `sender_email_ids` (query) — List of sender email IDs to include
- `campaign_ids` (query) — List of campaign IDs to include

---

## Campaigns v1.1

This section provides endpoints to manage campaign-related operations.

### `GET /api/campaigns/v1.1/{campaign_id}/sequence-steps`

**View campaign sequence steps (v1.1)**

This endpoint allows the authenticated user to view the sequence steps of the campaign.

---

### `POST /api/campaigns/v1.1/{campaign_id}/sequence-steps`

**Create sequence steps (v1.1)**

This endpoint allows the authenticated user to create the campaign sequence steps from scratch.

**Request Body** (`application/json`):
- `title` (string) *required* — The title for the sequence.
- `sequence_steps` (array) *required* — The array containing the sequence steps

---

### `PUT /api/campaigns/v1.1/sequence-steps/{sequence_id}`

**Update sequence steps (v1.1)**

This endpoint allows the authenticated user to update the campaign sequence steps.

**Request Body** (`application/json`):
- `title` (string) *required* — The title for the sequence.
- `sequence_steps` (array) *required* — The array containing the sequence steps

---

## Custom Lead Variables

Here you can manage all custom variables created for a given workspace

### `GET /api/custom-variables`

**Get all custom variables**

Retrieve a list of all custom variables for your workspace

---

### `POST /api/custom-variables`

**Create a new custom variable**

Add a new custom variable for your workspace

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the custom variable

---

## Ignore Phrases

APIs for managing ignore phrases. This includes retrieving, creating,
 and removing ignore phrases.

### `GET /api/ignore-phrases`

**Get all ignore phrases**

Retrieve a list of all ignore phrases for the authenticated user.

---

### `POST /api/ignore-phrases`

**Create ignore phrase**

Add a new ignore phrase

**Request Body** (`application/json`):
- `phrase` (string) *required* — The ignore phrase to add.

---

### `GET /api/ignore-phrases/{ignore_phrase_id}`

**Get single ignore phrase**

Retrieve the details of a specific ignore phrase

---

### `DELETE /api/ignore-phrases/{ignore_phrase_id}`

**Remove ignore phrase**

Remove an ignore phrase

---

## Leads

This group of endpoints allows for the management of contact (lead) information.

### `GET /api/leads`

**Get all leads**

Retrieve a list of all leads for the authenticated user.

**Parameters:**
- `search` (query) — Search term for filtering replies.
- `filters` (query)
- `filters.lead_campaign_status` (query) — Filter by lead campaign status. One of `in_sequence`, `sequence_finished`, `sequence_stopped`, `never_contacted`, `replied`.
- `filters.emails_sent` (query) — Filter by the number of emails sent.
- `filters.emails_sent.criteria` (query) — Comparison operator for emails sent. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.emails_sent.value` (query) — Value for the number of emails sent.
- `filters.opens` (query)
- `filters.opens.criteria` (query) — Comparison operator for email opens. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.opens.value` (query) — Value for the number of email opens.
- `filters.replies` (query)
- `filters.replies.criteria` (query) — Comparison operator for replies. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.replies.value` (query) — Value for the number of replies.
- `filters.verification_statuses` (query) — A verification status. Accepted values: `verifying`, `verified`, `risky`, `unknown`, `unverified`, `inactive`, `bounced`, `unsubscribed`
- `filters.tag_ids` (query) — Filter by tag IDs.
- `filters.excluded_tag_ids` (query) — Exclude leads by tag IDs.
- `filters.without_tags` (query) — Only show leads that have no tags attached.
- `filters.created_at` (query)
- `filters.created_at.criteria` (query) — Comparison operator for the created_at date. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.created_at.value` (query) — Value for the created_at date. Must be a valid date in YYYY-MM-DD format.
- `filters.updated_at` (query)
- `filters.updated_at.criteria` (query) — Comparison operator for the updated_at date. One of `=`, `>=`, `>`, `<=`, `<`.
- `filters.updated_at.value` (query) — Value for the updated_at date. Must be a valid date in YYYY-MM-DD format.

---

### `POST /api/leads`

**Create lead**

Create a single lead (contact) record

**Request Body** (`application/json`):
- `first_name` (string) *required* — The first name of the contact.
- `last_name` (string) *required* — The last name of the contact.
- `email` (string) *required* — The email address of the contact. Must be unique and in a valid email format.
- `title` (string) — optional The title of the contact.
- `company` (string) — optional The company name of the contact.
- `notes` (string) — optional Additional notes about the contact.
- `custom_variables` (array) — optional Array of custom variable objects

---

### `GET /api/leads/{lead_id}`

**Get single lead**

Retrieve the details of a specific lead

---

### `PUT /api/leads/{lead_id}`

**Update lead**

Update the details of a specific lead

Fields passed in the request will be updated. Fields and custom variables not passed will be cleared.

**Request Body** (`application/json`):
- `first_name` (string) *required* — The first name of the contact.
- `last_name` (string) *required* — The last name of the contact.
- `email` (string) *required* — The email address of the contact. Must be in a valid email format.
- `title` (string) — The title of the contact.
- `company` (string) — The company name of the contact.
- `notes` (string) — Additional notes about the contact.
- `custom_variables` (array) — Array of custom variable objects

---

### `PATCH /api/leads/{lead_id}`

**Update lead**

Update the details of a specific lead

Fields passed in the request will be updated. Fields and custom variables not passed will remain unchanged.

**Request Body** (`application/json`):
- `first_name` (string) — The first name of the contact.
- `last_name` (string) — The last name of the contact.
- `email` (string) — The email address of the contact. Must be in a valid email format.
- `title` (string) — The title of the contact.
- `company` (string) — The company name of the contact.
- `notes` (string) — Additional notes about the contact.
- `custom_variables` (array) — Array of custom variable objects

---

### `DELETE /api/leads/{lead_id}`

**Delete a lead**

Permanently delete a lead and its associated data

**Hold on. You may not need to delete leads.**
You may be able to simply re-upload leads instead

**I mapped the wrong custom variables for these leads**
No problem! Simply re-upload the leads and we'll update the records in place. This is especially useful if you already have lead history like conversations, campaigns, etc.

**I don't to email these leads anymore**
We recommend unsubscribing these leads instead. Bulk select -> Update Status -> Unsubscribe. This way, you can preserve the lead history and stats for future reports.

**I want to update these leads with more data**
Instead of deleting, simply re-upload the leads. We'll update the records in place. This includes all campaign emails too.

**I attached the wrong tags**
You can simply bulk select and remove tags instead of deleting the entire leads.

**I don't want to use too much data**
We have no limits on lead storage. You can store as many leads as you want. We recommend keeping the leads in your workspace for future campaigns.

**Why is it recommended to not delete leads?**
We build up history for every lead record you upload. There's no harm in keeping it in the workspace. If you delete leads, future responses from that lead will be untracked and not tied to any campaigns. This can be harder to manage for your team.

The behaviour of deleting leads comes from other sequencers that charge you for lead storage. You don't need to worry about deleting leads for 99% of use cases.

**If you still want to delete leads, please read below carefully**

**Leads will be removed from campaigns**
This will stop all future emails for the selected leads and remove them from all campaigns. If campaigns have no more leads remaining, they will be marked as "completed"

**Previous campaign stats will be preserved**
We will preserve all past campaign stats like replies, opens, emails sent, etc.

**Past and future lead conversations will be affected**
Past conversations will no longer be tied to these leads, and future emails in those conversations will show us as "untracked."

**Leads will no longer be accessible via API**
If you have workflows that use these leads, they will no longer work. These leads will be deleted permanently. If you re-upload them in the future, they will be different lead records.

**Future campaign stats will not be tracked**
If any of these leads reply in the future, those emails not increment any stats. They will show up as "untracked replies." This also means that any webhook workflows will also be affected.

**We recommend unsubscribing these leads instead**
If you simply don't want to email these leads anymore, we recommend unsubscribing them instead. This will preserve all data and all workflows, and there's no additional cost to you.

---

### `GET /api/leads/{lead_id}/replies`

**Get all replies for lead**

This endpoint retrieves all replies for a specific lead

The user must provide a valid authentication token in the request header to access this endpoint.

**Parameters:**
- `search` (query) — Search term for filtering replies.
- `status` (query) — Filter by status. One of `interested`, `automated_reply`, `not_automated_reply`.
- `folder` (query) — Filter by folder. One of `inbox`, `sent`, `spam`, `bounced`, `all`.
- `read` (query) — Filter by read status.
- `campaign_id` (query) — The ID of the campaign.
- `sender_email_id` (query) — The ID of the sender email address.
- `tag_ids` (query) — Array of tag IDs to filter by.

---

### `POST /api/leads/multiple`

**Bulk create leads**

Create multiple lead records in a single request (limit 500 per request)

Personal domains will be skipped unless enabled on your instance. get in touch with support if you want to send to personal domains (e.g. gmail.com)

**Request Body** (`application/json`):
- `leads` (array) *required* — An array of lead objects.

---

### `POST /api/leads/create-or-update/multiple`

**Update or create multiple leads**

Update or create multiple lead records in a single request (limit 500 per request).

Personal domains will be skipped unless enabled on your instance. get in touch with support if you want to send to personal domains (e.g. gmail.com)

**Request Body** (`application/json`):
- `existing_lead_behavior` (string) — The behavior to apply when a lead already exists.

If "put", replace all the lead's fields, including custom variables, with the fields from this request. Fields not passed are cleared.

If "patch", only update a field if it's passed. Fields and custom variables not passed are kept.

Will default to "put" if not passed.
- `leads` (array) *required* — An array of lead objects.

---

### `POST /api/leads/create-or-update/{lead_id}`

**Update or create lead**

Update the details of a specific lead if it exists, otherwise create a new record

**Request Body** (`application/json`):
- `existing_lead_behavior` (string) — The behavior to apply if the lead exists.

If "put", replace all the lead's fields, including custom variables, with the fields from this request. Fields not passed are cleared.

If "patch", only update a field if it's passed. Fields and custom variables not passed are kept.

Will default to "put" if not passed.
- `first_name` (string) *required* — The first name of the contact.
- `last_name` (string) *required* — The last name of the contact.
- `email` (string) *required* — The email address of the contact. Must be in a valid email format.
- `title` (string) — optional The title of the contact.
- `company` (string) — optional The company name of the contact.
- `notes` (string) — optional Additional notes about the contact.
- `custom_variables` (array) — optional Array of custom variable objects

---

### `PATCH /api/leads/{lead_id}/unsubscribe`

**Unsubscribe lead**

Unsubscribe a lead from scheduled emails.

---

### `POST /api/leads/{lead_id}/blacklist`

**Add lead to blacklist**

Add a lead to your global blacklist.

---

### `POST /api/leads/bulk/csv`

**Bulk create leads using CSV**

Create multiple leads in a single request using a CSV

**Request Body** (`multipart/form-data`):
- `name` (string) *required* — The name of the contact list
- `csv` (string) *required* — The CSV file containing the contacts.
- `existing_lead_behavior` (string) — The behavior to apply when a lead already exists.

If "put", replace all the lead's fields, including custom variables, with the fields from this request. Fields not passed are cleared.

If "patch", only update a field if it's passed. Fields and custom variables not passed are kept.

If "skip", do not process the lead.

Will default to "put" if not passed.
- `columnsToMap` (array) *required* — The array with the header fields from the csv.

---

### `GET /api/leads/{lead_id}/scheduled-emails`

**Get all scheduled emails**

Retrieves a collection of scheduled emails associated with a lead. These scheduled emails
can have multiple statuses including: `scheduled`, `sending paused`, `stopped`, `bounced`, `unsubscribed`, `replied`

---

### `GET /api/leads/{lead_id}/sent-emails`

**Get all sent emails for a lead**

Retrieves a collection of **sent** campaign emails associated with a lead on the authenticated workspace.

---

### `PATCH /api/leads/{lead_id}/update-status`

**Update lead status**

Update the status of a lead

**Request Body** (`application/json`):
- `status` (string) *required* — The status to apply to the lead.

---

### `PATCH /api/leads/bulk-update-status`

**Bulk update lead status**

Bulk update the status of multiple selected leads

**Request Body** (`application/json`):
- `lead_ids` (array) *required* — The array of lead IDs.
- `status` (string) *required* — The status to apply to the lead.

---

### `DELETE /api/leads/bulk`

**Bulk delete leads by ID**

Permanently delete leads and associated data

**Hold on. You may not need to delete leads.**
 You may be able to simply re-upload leads instead

 **I mapped the wrong custom variables for these leads**
 No problem! Simply re-upload the leads and we'll update the records in place. This is especially useful if you already have lead history like conversations, campaigns, etc.

 **I don't to email these leads anymore**
 We recommend unsubscribing these leads instead. Bulk select -> Update Status -> Unsubscribe. This way, you can preserve the lead history and stats for future reports.

 **I want to update these leads with more data**
 Instead of deleting, simply re-upload the leads. We'll update the records in place. This includes all campaign emails too.

 **I attached the wrong tags**
 You can simply bulk select and remove tags instead of deleting the entire leads.

 **I don't want to use too much data**
 We have no limits on lead storage. You can store as many leads as you want. We recommend keeping the leads in your workspace for future campaigns.

 **Why is it recommended to not delete leads?**
 We build up history for every lead record you upload. There's no harm in keeping it in the workspace. If you delete leads, future responses from that lead will be untracked and not tied to any campaigns. This can be harder to manage for your team.

 The behaviour of deleting leads comes from other sequencers that charge you for lead storage. You don't need to worry about deleting leads for 99% of use cases.

 **If you still want to delete leads, please read below carefully**

 **Leads will be removed from campaigns**
 This will stop all future emails for the selected leads and remove them from all campaigns. If campaigns have no more leads remaining, they will be marked as "completed"

 **Previous campaign stats will be preserved**
 We will preserve all past campaign stats like replies, opens, emails sent, etc.

 **Past and future lead conversations will be affected**
 Past conversations will no longer be tied to these leads, and future emails in those conversations will show us as "untracked."

 **Leads will no longer be accessible via API**
 If you have workflows that use these leads, they will no longer work. These leads will be deleted permanently. If you re-upload them in the future, they will be different lead records.

 **Future campaign stats will not be tracked**
 If any of these leads reply in the future, those emails not increment any stats. They will show up as "untracked replies." This also means that any webhook workflows will also be affected.

 **We recommend unsubscribing these leads instead**
 If you simply don't want to email these leads anymore, we recommend unsubscribing them instead. This will preserve all data and all workflows, and there's no additional cost to you.

**Request Body** (`application/json`):
- `lead_ids` (array) — The <code>id</code> of an existing record in the leads table.

---

## Reply Templates

This section provides endpoints to manage reply templates. You can then use these as templated responses
when sending replies to leads.

### `GET /api/reply-templates`

**Get all reply templates**

This endpoint retrieves all reply templates for the current workspace

The user must provide a valid authentication token in the request header to access this endpoint

**Parameters:**
- `search` (query) — optional string Use full text search to filter reply templates.

---

### `POST /api/reply-templates`

**Create a reply template**

This endpoint allows the authenticated user to create a new reply template

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the new reply template.
- `body` (string) *required* — The full contents of the reply template message.
- `attachments` (array) — optional Array of multi-part files that you want to attach with this template. Combined max size: 25MB, individual max size: 10MB.

---

### `GET /api/reply-templates/{id}`

**Reply template details**

---

### `PUT /api/reply-templates/{id}`

**Update a reply template**

This endpoint allows the authenticated user to update an existing reply template.
It will override the entire previous reply template, including attachments

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the new reply template.
- `body` (string) *required* — The full contents of the reply template message.
- `attachments` (array) — optional Array of multi-part files that you want to attach with this template. Combined max size: 25MB, individual max size: 10MB.

---

### `DELETE /api/reply-templates/{reply_template_id}`

**Delete reply template**

This endpoint will permanently delete the specified reply template

---

## Scheduled Emails

This section provides endpoints to manage scheduled emails.

### `GET /api/scheduled-emails`

**Get all scheduled emails**

This endpoint retrieves all scheduled (campaign) emails.

**Parameters:**
- `status` (query) — The status of the scheduled email.
- `campaign_ids` (query) — Campaign IDs to filter by.
- `lead_ids` (query) — Lead IDs to filter by.
- `sender_email_ids` (query) — Sender Email IDs to filter by.
- `scheduled_date_local` (query)
- `scheduled_date_local.value` (query) — The date the email was/is scheduled to be sent at. The timezone is the campaign's timezone. The format is YYYY-MM-DD.
- `scheduled_date_local.criteria` (query) — The criteria for the scheduled_date_local.

---

### `GET /api/scheduled-emails/{id}`

**Get scheduled email**

This endpoint retrieves a single scheduled (campaign) email.

---

## Warmup

This section provides endpoints to let you manage your warmup settings for email accounts (sender emails)

### `GET /api/warmup/sender-emails`

**List email accounts with warmup stats**

Retrieves a collection of email accounts associated with the authenticated workspace, along with
their warmup stats

**Parameters:**
- `search` (query) — optional Search term for filtering email accounts.
- `tag_ids` (query) — optional Array of tag IDs to filter by.
- `excluded_tag_ids` (query) — The <code>id</code> of an existing record in the tags table.
- `without_tags` (query) — Only show leads that have no tags attached.
- `warmup_status` (query) — The warmup status to filter by. Valid values: `enabled`, `disabled`
- `mx_records_status` (query) — The mx records status to filter by. Valid values: `records missing`, `records valid`
- `start_date` (query) *required* — The start date to fetch stats (defaults to 10 days ago).
- `end_date` (query) *required* — The end date to fetch stats (defaults to today).
- `filters.excluded_tag_ids` (query) — Exclude email accounts by tag IDs.
- `filters.without_tags` (query) — Only show email accounts that have no tags attached.

---

### `PATCH /api/warmup/sender-emails/enable`

**Enable warmup for email accounts**

This endpoint enables warmup for all the selected email accounts

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — Array of sender email IDs.

---

### `PATCH /api/warmup/sender-emails/disable`

**Disable warmup for email accounts**

This endpoint disables warmup for all the selected email accounts

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — Array of sender email IDs.

---

### `PATCH /api/warmup/sender-emails/update-daily-warmup-limits`

**Update daily warmup limits for email accounts**

This endpoint updates the daily warmup limits for selected email accounts

**Request Body** (`application/json`):
- `sender_email_ids` (array) *required* — Array of sender email IDs.
- `daily_limit` (integer) *required* — The daily limit of warmup emails to send
- `daily_reply_limit` (int|string) — The daily limit of warmup reply emails. You can pass an "auto" string to set this to auto.

WARNING: You should only use this section if explicitly told by your inbox reseller. We cannot be held responsible if you experience low inbox health as a result of controlling your own reply rate.

---

### `GET /api/warmup/sender-emails/{senderEmailId}`

**Show single email account with warmup details**

Retrieves a single email account (sender email) with its warmup details

**Parameters:**
- `start_date` (query) *required* — The start date to fetch stats.
- `end_date` (query) *required* — The end date to fetch stats.

---

## Webhook Events

APIs for managing webhook events, sending test events, and viewing samples

### `GET /api/webhook-events/sample-payload`

**Get sample webhook event payload**

**Request Body** (`application/json`):
- `event_type` (string) *required* — The event type.

---

### `GET /api/webhook-events/event-types`

**Get all webhook event types**

Shows you a list of all valid webhook event types that are supported

---

### `POST /api/webhook-events/test-event`

**Send a test webhook event**

Send a test webhook for a chosen event type

**Request Body** (`application/json`):
- `event_type` (string) *required* — The event type.
- `url` (string) *required* — The URL to send the webhook to. This must be an active URL that can receive requests.

---

## Workspaces v1 (deprecated)

This section provides endpoints to manage workspace-related operations.
It includes functionalities for creating, updating, and deleting workspaces

### `GET /api/workspaces`

**List Workspaces**

This endpoint retrieves all of the authenticated user's workspaces.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/workspaces`

**Create Workspace**

This endpoint allows the authenticated user to create a new workspace.

The user must provide a valid authentication token in the request header
and the details of the new workspace in the request body.

**Request Body** (`application/json`):
- `name` (string) *required* — The new workspace name.

---

### `POST /api/workspaces/switch-workspace`

**Switch Workspace**

This endpoint allows the authenticated user to switch to a different workspace.

The user must provide a valid authentication token in the request header
and the ID of the target workspace in the request body to access this endpoint.

**Request Body** (`application/json`):
- `team_id` (integer) *required* — The ID of the team to switch.

---

### `PUT /api/workspaces/{team_id}`

**Update Workspace**

This endpoint allows the authenticated user to update their workspace information,
specifically the workspace name.

The user must provide a valid authentication token in the request header
and the ID of the target workspace, along with the details of the new workspace
in the request body to access this endpoint.

**Request Body** (`application/json`):
- `name` (string) *required* — The new workspace name.

---

### `GET /api/workspaces/{team_id}`

**Workspace Details**

This endpoint retrieves the details of the authenticated user's workspace.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/workspaces/invite-members`

**Invite Team Member**

This endpoint allows the authenticated user to invite a new member to their team.

The user must provide a valid authentication token in the request header
and the email and role of the new team member in the request body.

**Request Body** (`application/json`):
- `email` (string) *required* — The email of the new team member.
- `role` (string) *required* — The role of the new team member.

---

### `POST /api/workspaces/accept/{team_invitation_id}`

**Accept Workspace Invitation**

This endpoint allows the user to accept an invitation to join a workspace.

The user must provide a valid authentication token in the request header
and the ID of the workspace invitation.

---

### `PUT /api/workspaces/members/{user_id}`

**Update Workspace Member**

This endpoint allows the authenticated user to update the role of a workspace member.

The user must provide a valid authentication token in the request header
and the ID of the workspace member and the new role in the request body.

**Request Body** (`application/json`):
- `role` (string) *required* — The new role of the team member.

---

### `DELETE /api/workspaces/members/{user_id}`

**Delete Workspace Member**

This endpoint allows the authenticated user to remove a workspace member.

The user must provide a valid authentication token in the request header
and the ID of the workspace member.

---

## Workspaces v1.1

This section provides endpoints to manage workspace-related operations.
It includes functionalities for creating, updating, and deleting workspaces

### `GET /api/workspaces/v1.1`

**List Workspaces**

This endpoint retrieves all of the authenticated user's workspaces.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/workspaces/v1.1`

**Create Workspace**

This endpoint allows the authenticated user to create a new workspace.

The user must provide a valid authentication token in the request header
and the details of the new workspace in the request body.

**Request Body** (`application/json`):
- `name` (string) *required* — The new workspace name.

---

### `POST /api/workspaces/v1.1/users`

**Create User (and add to workspace)**

This endpoint provides a convenient way to create a new user on your instance, and
add them to the current workspace. This provides an alternate flow where you want to mass
create users.

If you simply want to invite users and have them accept the invitation, or accept it
programmatically, consider using the other endpoints.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the user
- `password` (string) *required* — The password of the user.
- `email` (string) *required* — The email of the user.
- `role` (string) *required* — The role of the new team member.

---

### `POST /api/workspaces/v1.1/{team_id}/api-tokens`

**Create API token for workspace**

This endpoint lets you create an API token for a given workspace

Requires a "super admin" API token

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the user

---

### `POST /api/workspaces/v1.1/switch-workspace`

**Switch Workspace**

This endpoint allows the authenticated user to switch to a different workspace.

The user must provide a valid authentication token in the request header
and the ID of the target workspace in the request body to access this endpoint.

**Request Body** (`application/json`):
- `team_id` (integer) *required* — The ID of the team (workspace) to switch.

---

### `DELETE /api/workspaces/v1.1/{team_id}`

**Delete Workspace**

This endpoint allows the authenticated user to delete a workspace.

The user must provide a valid super-admin authentication token in the request header
and the ID of the target workspace in the query parameters to access this endpoint.

---

### `PUT /api/workspaces/v1.1/{team_id}`

**Update Workspace**

This endpoint allows the authenticated user to update their workspace information,
specifically the workspace name.

The user must provide a valid authentication token in the request header
and the ID of the target workspace, along with the details of the new workspace
in the request body to access this endpoint.

**Request Body** (`application/json`):
- `name` (string) *required* — The new workspace name.

---

### `GET /api/workspaces/v1.1/{team_id}`

**Workspace Details**

This endpoint retrieves the details of the authenticated user's workspace.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/workspaces/v1.1/invite-members`

**Invite Team Member**

This endpoint allows the authenticated user to invite a new member to their team.

The user must provide a valid authentication token in the request header
and the email and role of the new team member in the request body.

**Request Body** (`application/json`):
- `email` (string) *required* — The email of the new team member.
- `role` (string) *required* — The role of the new team member.

---

### `POST /api/workspaces/v1.1/accept/{team_invitation_id}`

**Accept Workspace Invitation**

This endpoint allows the user to accept an invitation to join a workspace.

The user must provide a valid authentication token in the request header
and the ID of the workspace invitation.

---

### `DELETE /api/workspaces/v1.1/members/{user_id}`

**Delete Workspace Member**

This endpoint allows the authenticated user to remove a workspace member.

This does not delete the user account. It only removes them from the workspace.

The user must provide a valid authentication token in the request header
and the ID of the workspace member.

---

### `GET /api/workspaces/v1.1/master-inbox-settings`

**Get Master Inbox Settings**

This endpoint retrieves the master inbox settings for this workspace.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `PATCH /api/workspaces/v1.1/master-inbox-settings`

**Update Master Inbox Settings**

This endpoint updates the master inbox settings for this workspace.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `sync_all_emails` (boolean) — If set to true, all emails (incoming an outgoing) will be synced.
If set to false, only replies to your campaign emails will be synced.

Only set to false if you are managing your master inbox in another app and want to reduce noise.
- `smart_warmup_filter` (boolean) — If set to true, we will check each email for hyphenated words (eg. strong-bison),
and automatically discard them from being synced
- `auto_interested_categorization` (boolean) — If set to true, we will use <strong>GPT-4o-mini</strong> to check the contents
of your email to determine if the response is interested is not.
This categorization only runs for the first unique reply from a contact.

---

### `GET /api/workspaces/v1.1/stats`

**Get workspace stats (summary)**

This endpoint retrieves overall stats for this workspace between two given dates.

The user must provide a valid authentication token in the request header to access this endpoint.

**Parameters:**
- `start_date` (query) *required* — The start date to fetch stats.
- `end_date` (query) *required* — The end date to fetch stats.

---

### `GET /api/workspaces/v1.1/line-area-chart-stats`

**Get full normalized stats by date**

This endpoint retrieves stats by date for a given period

The user must provide a valid authentication token in the request header to access this endpoint.

Events returned: `Replied`, `Total Opens`, `Unique Opens`, `Sent`, `Bounced`, `Unsubscribed`, `Interested`

**Parameters:**
- `start_date` (query) *required* — The start date to fetch stats.
- `end_date` (query) *required* — The end date to fetch stats.

---

