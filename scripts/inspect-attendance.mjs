import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15000) }) },
});
const queries = {
  institutions: "id,name,code,status",
  classes: "id,institution_id,name,section,full_name,active",
  students: "id,institution_id,class_id,parent_id,enrollment_status",
  faculty: "id,institution_id,user_id,active",
  class_faculty: "institution_id,class_id,faculty_id",
  profiles: "id,auth_user_id,status",
  profile_institutions: "profile_id,institution_id,status",
  profile_roles: "profile_id,institution_id,role_code",
  attendance_sessions: "id,institution_id,class_id,date,total_present,total_absent,total_late",
};
await Promise.all(
  Object.entries(queries).map(async ([table, columns]) => {
    const { data, error } = await db.from(table).select(columns);
    console.log(
      JSON.stringify({ table, ...(error ? { error } : { count: data.length, rows: data }) }),
    );
  }),
);
const { data, error } = await db.from("students").select("*,classes(*),parents(*)").limit(1);
console.log(
  JSON.stringify({
    joinedStudentQuery: error
      ? { code: error.code, message: error.message, details: error.details }
      : { count: data.length, hasClass: !!data[0]?.classes, hasParent: !!data[0]?.parents },
  }),
);
