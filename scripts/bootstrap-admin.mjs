// Retired: bypassing institution verification must never create an initial owner.
console.error(
  "Direct institution/admin bootstrap is disabled. Submit an institution verification application and complete independent platform review. See docs/institution-verification.md.",
);
process.exitCode = 1;
