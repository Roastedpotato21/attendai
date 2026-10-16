# Twilio support request — October 5 SMS outcome

Draft only; not sent.

Please reconcile an outbound Programmable Messaging API request in the account
from which this support ticket is submitted:

- Request start: **2026-10-05 08:48:39.844877 UTC** (14:18:39.844877 IST).
- Endpoint: `POST /2010-04-01/Accounts/<this-account>/Messages.json`.
- Controlled recipient: `+91******6753` (the account owner can supply the full
  number privately if needed).
- Application communication ID: `8529906c-bc04-4041-828d-94afb5293a68`.
- Application job ID: `185d512d-2e26-4a43-a2e5-d0fbbbcd5cdb`.
- The application recorded one started request, an uncertain outcome, and no SID.
- On October 12 IST, the recipient Message list was empty and outbound SMS usage
  for October 5–7 was zero. The Trial account cannot access Monitor Alerts or
  Events: both return HTTP 401, code 20003, with a Trial-account restriction.

Please confirm whether this exact request was rejected before message creation
and carrier submission, or whether an SMS was accepted/submitted/delivered.
Provide the correlated request/alert ID, original response status/error, and
Message SID/carrier outcome if a message was created. Please explicitly state
whether any SMS could have been delivered from this request.

A separate October 6 request returned HTTP 422 / code 572002. That is a different
request and must not be used to classify the October 5 outcome.

We have paused replacement delivery to prevent duplicates. Please do not send
any test messages or replay either request during this investigation.
