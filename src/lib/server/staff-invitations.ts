/** Legacy writes bypass the Phase 2A role/assignment/invitation model. */
const retired = () =>
  Response.json(
    {
      error:
        "This staff endpoint is retired. Use Institution Setup / Staff. Ownership and staff deactivation lifecycle are outside Phase 2A.",
    },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
export async function handleStaffInvitationRequest(_request: Request): Promise<Response> {
  return retired();
}
export async function handleStaffManagementRequest(_request: Request): Promise<Response> {
  return retired();
}
