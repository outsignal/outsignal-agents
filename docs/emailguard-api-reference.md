# EmailGuard API Reference

Base URL: `https://app.emailguard.io`

## Authentication

This section provides endpoints for user authentication and token retrieval

### `POST /api/v1/login`

**Login**

This endpoint allows users to authenticate by providing your login credentials (email and password).

Upon successful authentication, the endpoint returns a JSON response containing the authentication token
to be used for accessing protected resources.

**Request Body** (`application/json`):
- `email` (string) *required* — Your email.
- `password` (string) *required* — Your password.

---

## Account management

This section handles operations related to user accounts within the application.
It includes endpoints for user registration, profile management and password reset.

### `GET /api/v1/user`

**Account Details**

This endpoint retrieves the details of the authenticated user.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `PUT /api/v1/user/profile`

**Update Profile**

This endpoint allows the authenticated user to update their profile information, specifically their name.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `name` (string) *required* — The new name to update.

---

### `PUT /api/v1/user/password`

**Update Password**

This endpoint allows the authenticated user to update their password.

The user must provide a valid authentication token in the request header to access this endpoint.

**Request Body** (`application/json`):
- `current_password` (string) *required* — Your current password.
- `password` (string) *required* — Your new password.
- `password_confirmation` (string) *required* — Your new password repeated.

---

### `POST /api/v1/user/logout`

**Logout**

This endpoint logs out the authenticated user by invalidating their current authentication token.

The user must provide a valid authentication token in the request header to access this endpoint.

---

## Workspaces

This section provides endpoints to manage workspace-related operations.
It includes functionalities for creating, updating, and deleting workspaces

### `GET /api/v1/workspaces`

**User Workspaces**

This endpoint retrieves all workspaces for the authenticated user.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/v1/workspaces`

**Create Workspace**

This endpoint allows the authenticated user to create a new workspace.

The user must provide a valid authentication token in the request header
and the details of the new workspace in the request body.

**Request Body** (`application/json`):
- `name` (string) *required* — Must not be greater than 255 characters.

---

### `GET /api/v1/workspaces/current`

**Workspace Details**

This endpoint retrieves the details of the authenticated user's current workspace.

The user must provide a valid authentication token in the request header to access this endpoint.

---

### `POST /api/v1/workspaces/switch-workspace`

**Switch Workspace**

This endpoint allows the authenticated user to switch to a different workspace.

The user must provide a valid authentication token in the request header
and the ID of the target workspace in the request body to access this endpoint.

**Request Body** (`application/json`):
- `uuid` (string) *required* — The <code>uuid</code> of an existing record in the teams table.

---

### `PUT /api/v1/workspaces/{team_id}`

**Update Workspace**

This endpoint allows the authenticated user to update their workspace information,
specifically the workspace name.

The user must provide a valid authentication token in the request header
and the ID of the target workspace, along with the details of the new workspace
in the request body to access this endpoint.

**Request Body** (`application/json`):
- `name` (string) *required* — The new workspace name.

---

### `POST /api/v1/workspaces/invite-members`

**Invite Team Member**

This endpoint allows the authenticated user to invite a new member to their team.

The user must provide a valid authentication token in the request header
and the email and role of the new team member in the request body.

**Request Body** (`application/json`):
- `email` (string) *required* — The email of the new team member.
- `role` (string) *required* — The role of the new team member.

---

### `GET /api/v1/workspaces/accept/{team_invitation_uuid}`

**Accept Workspace Invitation**

This endpoint allows the user to accept an invitation to join a workspace.

The user must provide a valid authentication token in the request header
and the ID of the workspace invitation.

---

### `PUT /api/v1/workspaces/members/{user_id}`

**Update Workspace Member**

This endpoint allows the authenticated user to update the role of a workspace member.

The user must provide a valid authentication token in the request header
and the ID of the workspace member and the new role in the request body.

**Request Body** (`application/json`):
- `role` (string) *required* — The new role of the team member.

---

### `DELETE /api/v1/workspaces/members/{user_id}`

**Delete Workspace Member**

This endpoint allows the authenticated user to remove a workspace member.

The user must provide a valid authentication token in the request header
and the ID of the workspace member.

---

## Domains

This section manages operations related to domain management for authenticated users.
It provides endpoints for listing, creating, updating, and deleting domains.
Additionally, there are endpoints for managing SPF, DKIM, and DMARC records
associated with each domain to enhance email security and authentication.

### `GET /api/v1/domains`

**List Domains**

Retrieve a collection of domains associated with the authenticated user.

---

### `POST /api/v1/domains`

**Create Domain**

Create a new domain for the authenticated user.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the new domain.

---

### `GET /api/v1/domains/{uuid}`

**Show Domain Details**

Retrieve details of a specific domain.

---

### `PATCH /api/v1/domains/spf-record/{domain_uuid}`

**Update SPF Records**

Update SPF records for a specific domain.

---

### `PATCH /api/v1/domains/dkim-records/{domain_uuid}`

**Update DKIM Records**

Update DKIM records for a specific domain.

**Request Body** (`application/json`):
- `dkim_selectors` (json) *required* — The DKIM selectors.

---

### `PATCH /api/v1/domains/dmarc-record/{domain_uuid}`

**Update DMARC Record**

Update DMARC record for a specific domain.

---

### `DELETE /api/v1/domains/delete/{domain_uuid}`

**Delete Domain**

Delete a domain associated with the authenticated user.

---

## Email Accounts

This section provides endpoints to manage email accounts associated with a workspace.
It includes functionalities for listing all email accounts, retrieving details of a specific email account,
creating new IMAP/SMTP email accounts, testing IMAP and SMTP connections, and deleting existing email accounts.

### `GET /api/v1/email-accounts`

**List Email Accounts**

Retrieves a collection of email accounts associated with the authenticated workspace.

---

### `GET /api/v1/email-accounts/{id}`

**Show Email Account Details**

Retrieves details of a specific email account.

---

### `POST /api/v1/email-accounts/imap-smtp`

**Create IMAP/SMTP Email Account**

Creates a new IMAP/SMTP email account for the authenticated workspace.

**Request Body** (`application/json`):
- `name` (string) *required* — The name for the email account.
- `provider` (integer) *required* — The provider for the authentication.
- `imap_username` (string) *required* — The username for IMAP authentication.
- `imap_password` (string) *required* — The password for IMAP authentication.
- `imap_host` (string) *required* — The host for IMAP
- `imap_port` (string) *required* — The port for IMAP
- `imap_tls` (string) — optional The TLS for IMAP
- `smtp_username` (string) *required* — The username for SMTP authentication.
- `smtp_password` (string) *required* — The password for SMTP authentication.
- `smtp_host` (string) *required* — The host for SMTP.
- `smtp_port` (string) *required* — The port for SMTP.
- `smtp_tls` (optional) *required* — The TLS for SMTP.

---

### `POST /api/v1/email-accounts/test-imap-connection`

**Test IMAP Connection**

Tests the IMAP connection for the provided credentials.

**Request Body** (`application/json`):
- `imap_username` (string) *required* — The username for IMAP authentication.
- `imap_password` (string) *required* — The password for IMAP authentication.
- `imap_host` (string) *required* — The host for IMAP
- `imap_port` (string) *required* — The port for IMAP
- `imap_tls` (string) — optional The TLS for IMAP

---

### `POST /api/v1/email-accounts/test-smtp-connection`

**Test SMTP Connection**

Tests the SMTP connection for the provided credentials.

**Request Body** (`application/json`):
- `smtp_username` (string) *required* — The username for SMTP authentication.
- `smtp_password` (string) *required* — The password for SMTP authentication.
- `smtp_host` (string) *required* — The host for SMTP.
- `smtp_port` (string) *required* — The port for SMTP.
- `smtp_tls` (optional) *required* — The TLS for SMTP.

---

### `DELETE /api/v1/email-accounts/delete/{email_account_uuid}`

**Delete Email Account**

Deletes an IMAP/SMTP email account associated with the authenticated workspace.

---

## Contact Verification

This section provides endpoints to manage and verify contact lists.
It includes functionalities for listing all contact lists, retrieving details of a specific contact list,
downloading completed contact lists, and creating new contact verification requests.

### `GET /api/v1/contact-verification`

**List Contact Lists**

Retrieves a collection of contact lists associated with the authenticated user.

---

### `POST /api/v1/contact-verification`

**Create Contact Verification**

Creates a new contact verification request for the authenticated user.

**Request Body** (`multipart/form-data`):
- `csv` (string) *required* — The CSV file containing the contacts. The csv needs to have an "email" field.
- `name` (string) *required* — The name of the contact list.

---

### `GET /api/v1/contact-verification/show/{contact_list_uuid}`

**Show Contact List Details**

Retrieves details of a specific contact list.

---

### `GET /api/v1/contact-verification/download/{contact_list_uuid}`

**Download Contact List**

Allows the user to download a completed contact list.

---

## Blacklist Checks

This section provides endpoints to manage and perform blacklist checks on domains
and email accounts. It includes functionalities for listing all blacklist checks for domains and email accounts,
retrieving details of a specific blacklist check, and creating new ad-hoc blacklist checks.

### `GET /api/v1/blacklist-checks/domains`

**List Domain Blacklists**

Retrieves a collection of blacklist checks for domains associated with the authenticated user.

---

### `GET /api/v1/blacklist-checks/email-accounts`

**List Email Account Blacklists**

Retrieves a collection of blacklist checks for email accounts associated with the authenticated user.

---

### `POST /api/v1/blacklist-checks/ad-hoc`

**Create Ad-Hoc Blacklist Check**

Creates a new ad-hoc blacklist check for the authenticated user.

**Request Body** (`application/json`):
- `domain_or_ip` (string) *required* — The domain or IPv4 IP address to check.

---

### `GET /api/v1/blacklist-checks/{id}`

**Show Blacklist Check Details**

Retrieves details of a specific blacklist check.

---

## DMARC Reports

This section provides endpoints to manage and retrieve DMARC reports
for domains associated with a workspace. It includes functionalities for listing domains with DMARC reports,
retrieving DMARC report statistics, sources, and failures for specific domains between two dates.

### `GET /api/v1/dmarc-reports`

**List DMARC Report Domains**

Retrieves a collection of domains that have DMARC reports associated with the authenticated workspace.

---

### `GET /api/v1/dmarc-reports/domains/{domain_uuid}/insights`

**Get DMARC Report Statistics**

Retrieves DMARC report statistics for a specific domain between two dates.

**Request Body** (`application/json`):
- `start_date` (string) *required* — The start date for the report in YYYY-MM-DD format.
- `end_date` (string) *required* — The end date for the report in YYYY-MM-DD format.

---

### `GET /api/v1/dmarc-reports/domains/{domain_uuid}/dmarc-sources`

**Get DMARC Report Sources**

Retrieves DMARC report sources for a specific domain between two dates.

**Request Body** (`application/json`):
- `start_date` (string) *required* — The start date for the report in YYYY-MM-DD format.
- `end_date` (string) *required* — The end date for the report in YYYY-MM-DD format.

---

### `GET /api/v1/dmarc-reports/domains/{domain_uuid}/dmarc-failures`

**Get DMARC Report Failures**

Retrieves DMARC report failures for a specific domain between two dates.

**Request Body** (`application/json`):
- `start_date` (string) *required* — The start date for the report in YYYY-MM-DD format.
- `end_date` (string) *required* — The end date for the report in YYYY-MM-DD format.

---

## Email Authentication

This section provides endpoints to manage SPF, DKIM, and DMARC records for domains.
It includes functiona'lities for looking up, validating, and generating SPF, DKIM, and DMARC records.

### `GET /api/v1/email-authentication/spf-lookup`

**SPF Lookup**

Retrieves and validates the SPF records for a given domain.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to lookup the SPF records for.

---

### `POST /api/v1/email-authentication/spf-generator-wizard`

**SPF Generator Wizard**

Generates an SPF record based on selected providers.

**Request Body** (`application/json`):
- `providers` (json) *required* — List of provider names to include in the SPF record.

---

### `POST /api/v1/email-authentication/spf-raw-generator`

**SPF Raw Generator**

Generates a raw SPF record based on provided values.

**Request Body** (`application/json`):
- `redirect` (boolean) — Whether to use redirect in the SPF record.
- `redirect_url` (string) — The redirect URL for the SPF record.
- `failure_policy` (string) — The SPF failure policy to use.
- `tag` (string) — The SPF tag to use.
- `value` (string) — The value for the SPF tag.

---

### `GET /api/v1/email-authentication/dkim-lookup`

**DKIM Lookup**

Retrieves and validates the DKIM records for a given domain and selector.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to lookup the DKIM records for.
- `selector` (string) *required* — The selector for the DKIM records.

---

### `POST /api/v1/email-authentication/dkim-raw-generator`

**DKIM Raw Generator**

Generates a raw DKIM record.

**Request Body** (`application/json`):
- `keyLength` (integer) *required* — The key length for the DKIM record.

---

### `GET /api/v1/email-authentication/dmarc-lookup`

**DMARC Lookup**

Retrieves and validates the DMARC records for a given domain.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to lookup the DMARC records for.

---

### `POST /api/v1/email-authentication/dmarc-connected-domain`

**Generate DMARC for Connected Domain**

Generates a DMARC record for a connected domain with a random DMARC inbox name.

**Request Body** (`application/json`):
- `domain_uuid` (string) *required* — The UUID of the connected domain.
- `policy` (string) *required* — The DMARC policy to use.

---

### `POST /api/v1/email-authentication/dmarc-another-domain`

**Generate DMARC for Another Domain**

Generates a DMARC record for another domain with a specified reporting address.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to lookup the DMARC records for.
- `policy` (string) *required* — The DMARC policy to use.
- `rua` (string) *required* — The reporting address for DMARC reports.

---

## Content Spam Check

This section provides an endpoint to check content for spam.
It includes functionalities for submitting content for spam check and managing usage limits.

### `POST /api/v1/content-spam-check`

**Check Content for Spam**

Submits content to check for spam

**Request Body** (`application/json`):
- `content` (string) *required* — The content to check for spam.

---

## Hosted Domain Redirect

This section provides endpoints to manage hosted domain redirects.
It includes functionalities for listing, creating, viewing, and deleting hosted domain redirects.

### `GET /api/v1/hosted-domain-redirects/ip`

**IP of Hosted Domain Redirect**

Retrieves the ip of the current workspace's hosted domain redirect

---

### `GET /api/v1/hosted-domain-redirects`

**List Hosted Domain Redirects**

Retrieves a list of hosted domain redirects associated with the authenticated user workspace.

---

### `POST /api/v1/hosted-domain-redirects`

**Create Hosted Domain Redirect**

Creates a new hosted domain redirect for the authenticated user workspace.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to redirect.
- `redirect` (string) *required* — The URL to redirect to.

---

### `GET /api/v1/hosted-domain-redirects/{id}`

**Show Hosted Domain Redirect**

Retrieves details of a specific hosted domain redirect.

---

### `DELETE /api/v1/hosted-domain-redirects/{hosted_domain_redirect_uuid}`

**Delete Hosted Domain Redirect**

Deletes a specific hosted domain redirect.

---

## Domain Host Lookup

Find the domain host or corporate spam filter for any domain.

### `POST /api/v1/domain-host-lookup`

**Domain Host Lookup**

This endpoint allows you to lookup the domain host for a given domain.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to lookup.

---

## Domain Masking Proxy

This section provides endpoints to manage all your domain masking proxies.

### `GET /api/v1/domain-masking-proxies/ip`

**IP of Domain Masking Proxy**

Retrieves the ip of the current workspace's domain masking proxy

---

### `GET /api/v1/domain-masking-proxies`

**List Domain Masking Proxies**

Retrieves a list of hosted domain redirects associated with the authenticated user workspace.

---

### `POST /api/v1/domain-masking-proxies`

**Create Domain Masking Proxy**

Create a new domain masking proxy for the authenticated user workspace.

**Request Body** (`application/json`):
- `masking_domain` (string) *required* — The secondary domain you want to act as the mask.
- `primary_domain` (string) *required* — The primary domain you want to hide.

---

### `GET /api/v1/domain-masking-proxies/{hosted_domain_redirect_uuid}`

**Show Domain Masking Proxy**

Retrieves details of a specific domain masking proxy

---

### `DELETE /api/v1/domain-masking-proxies/{hosted_domain_redirect_uuid}`

**Delete Domain Masking Proxy**

Deletes a specific domain masking proxy

---

## Email Host Lookup

Find the email host or corporate spam filter for any email address.

### `POST /api/v1/email-host-lookup`

**Email Host Lookup**

This endpoint allows you to lookup the email service provider for a given email address.

**Request Body** (`application/json`):
- `email` (string) *required* — The email address to lookup.

---

## Inbox Placement Tests

This section provides endpoints to manage and perform inbox placement tests using test inboxes on various
Email Service providers.

### `GET /api/v1/inbox-placement-tests`

**List Inbox Placement Tests**

Retrieves a collection of inbox placement tests associated with the authenticated user.

---

### `POST /api/v1/inbox-placement-tests`

**Create Inbox Placement Test**

Create a new inbox placement test

**Request Body** (`application/json`):
- `name` (string) *required*

---

### `GET /api/v1/inbox-placement-tests/{id}`

**Show Inbox Placement Test**

Shows an inbox placement test with all its details

---

## SURBL Blacklist Checks

This section provides endpoints to manage and perform SURBL blacklist checks on domains.

### `GET /api/v1/surbl-blacklist-checks/domains`

**List SURBL Blacklists**

Retrieves a collection of SURBL blacklist checks for domains associated with the authenticated user.

---

### `GET /api/v1/surbl-blacklist-checks/{surblBlacklistCheck_uuid}`

**Show SURBL Blacklist Check**

Retrieves a specific SURBL blacklist check by its UUID.

---

### `POST /api/v1/surbl-blacklist-checks`

**Create SURBL Blacklist Check**

Creates a new ad-hoc SURBL blacklist check for a specified domain.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to check against SURBL blacklists.

---

## Spam Filter Tests

This section provides endpoints to manage email tests associated with a workspace.
It includes functionalities for listing all email tests, retrieving details of a specific email test,
and creating new email tests.

### `GET /api/v1/spam-filter-tests`

**List Spam Filter Tests**

Retrieves a collection of spam filter tests associated with the authenticated workspace.

---

### `POST /api/v1/spam-filter-tests`

**Create Spam Filter Test**

Creates a new email test for the authenticated workspace.

**Request Body** (`application/json`):
- `name` (string) *required* — The name for the email test.

---

### `GET /api/v1/spam-filter-tests/{email_test_uuid}`

**Show Spam Filter Test Details**

Retrieves details of a specific spam filter test.

---

## Spamhaus A Record Reputation

A records are the A (or AAAA) records to which the domain or www.domain resolves to.

### `GET /api/v1/spamhaus-intelligence/a-record-reputation`

**List A Record Reputation Checks**

Retrieves a paginated collection of Spamhaus A Record Reputation Checks.
Each check includes status, A records, and their associated IP addresses with reputation scores, counters, and last-seen timestamps.

---

### `POST /api/v1/spamhaus-intelligence/a-record-reputation/create`

**Create A Record Reputation Check**

Queues a new A record reputation check for the given domain.
The job is processed asynchronously. You must poll the `show` endpoint
to retrieve results.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to resolve and check.

---

### `GET /api/v1/spamhaus-intelligence/a-record-reputation/{spamhausARecordReputationCheck_uuid}`

**Show A Record Reputation Check**

Retrieve the results of a spamhaus a record reputation check.
The record is created by the `create` endpoint and processed
asynchronously; poll this endpoint until the `status` becomes 'completed'

---

## Spamhaus Domain Context

A context indicates where the domain was observed within the signals Spamhaus receive and analyze.

### `GET /api/v1/spamhaus-intelligence/domain-contexts`

**List Domain Context Checks**

Retrieves a paginated collection of Spamhaus Domain Context Checks.
Each check includes the domain, status, and an array of context sources
where the domain was seen (e.g., `helo`, `mailbody`, `osint`, etc.).

---

### `POST /api/v1/spamhaus-intelligence/domain-contexts/create`

**Create Domain Context Check**

Queues a new domain context check using Spamhaus Intelligence data.
It identifies where the domain has been seen across signals like `helo`, `dkim`, `osint`, etc.
The result is processed asynchronously — use the `show` endpoint to poll results.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to check.

---

### `GET /api/v1/spamhaus-intelligence/domain-contexts/{spamhausDomainContextCheck_uuid}`

**Show Domain Context Check**

Retrieves the details of a specific domain context check by its UUID.
The record is created by the `create` endpoint and processed
Contexts indicate where the domain was observed in spam intelligence sources.

---

## Spamhaus Domain Reputation

Get real-time reputation intelligence from Spamhaus, a leading provider of DNS, email, and malware-related data.

### `GET /api/v1/spamhaus-intelligence/domain-reputation`

**List Domain Reputation Checks**

Retrieves a paginated collection of Spamhaus Domain Reputation Checks.
Each check includes status, reputation, general domain data, dimensions, blacklist status,
and IP reputation (if available).

---

### `POST /api/v1/spamhaus-intelligence/domain-reputation/create`

**Create Domain Reputation Check**

Queues a domain reputation check using Spamhaus Intelligence data.
It performs four separate checks: general domain info, reputation dimensions,
listing status, and IP reputation.
The result is processed asynchronously — use the `show` endpoint to poll for completion.

This operation consumes **4 credits**.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to perform the spamhaus domain reputation check.

---

### `GET /api/v1/spamhaus-intelligence/domain-reputation/{spamhausDomainReputationCheck_uuid}`

**Show Domain Reputation Check**

Retrieve the results of a single spamhaus domain reputation check by its UUID.
The record is created by the `create` endpoint and processed
asynchronously; poll this endpoint until `status` becomes `completed`

---

## Spamhaus Domain Sender

This API call fetches information relating to the IP addresses that have been seen sending emails for the domain.

### `GET /api/v1/spamhaus-intelligence/domain-senders`

**List Domain Sender Checks**

Retrieves a paginated collection of Spamhaus Domain Sender Checks.

---

### `POST /api/v1/spamhaus-intelligence/domain-senders/create`

**Create Domain Sender Check**

Queues a new domain sender check using Spamhaus Intelligence data.
The result is processed asynchronously — use the `show` endpoint to poll results.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain to check.

---

### `GET /api/v1/spamhaus-intelligence/domain-senders/{spamhausDomainSenderCheck_uuid}`

**Show Domain Sender Check**

Retrieves the details of a specific domain sender check by its UUID.
The record is created by the `create` endpoint and processed

---

## Spamhaus Nameserver Reputation

This API call delivers a list of nameservers operating as authoritatives for this domain, including current and historical ones.

### `GET /api/v1/spamhaus-intelligence/nameserver-reputation`

**List Nameserver Reputation Checks**

Retrieves a paginated collection of Spamhaus Nameserver Reputation Checks.
The reputation score of a nameserver is the average reputation of the domains for which the NS is authoritative, while the counter shows the total number of domains served by such NS.

---

### `POST /api/v1/spamhaus-intelligence/nameserver-reputation/create`

**Create Nameserver Reputation Check**

Queues a new nameserver reputation check using Spamhaus Intelligence data.
The result is processed asynchronously — use the `show` endpoint to poll results.

**Request Body** (`application/json`):
- `domain` (string) *required* — The domain for which to perform the nameserver reputation check.

---

### `GET /api/v1/spamhaus-intelligence/nameserver-reputation/{spamhausNsReputationCheck_uuid}`

**Show Nameserver Reputation Check**

Retrieves the details of a specific nameserver reputation check by its UUID.
The record is created by the `create` endpoint

---

## Tags

This section provides endpoints to create and manage tags.

### `GET /api/v1/tags`

**List tags**

Returns all tags belonging to the authenticated user.

---

### `POST /api/v1/tags`

**Create tag**

Creates a new tag for the authenticated user.

**Request Body** (`application/json`):
- `name` (string) *required* — The name of the tag.
- `color` (string) *required* — The hex color for the tag.

---

### `GET /api/v1/tags/{uuid}`

**Show tag**

Returns a single tag identified by its UUID.

---

### `DELETE /api/v1/tags/{tag_uuid}`

**Delete tag**

Deletes a tag identified by its UUID.
This action is permanent and cannot be undone. This tag and all related data
will be deleted permanently.

---

