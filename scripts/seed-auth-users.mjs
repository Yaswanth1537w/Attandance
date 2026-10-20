import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const domain = "@siddhartha.ac.in";
const users = [
  { email: `incharge${domain}`, password: "Incharge@123", name: "Technical Event In-Charge", department: "Administration" },
  { email: `proctor1${domain}`, password: process.env.INITIAL_PROCTOR_PASSWORD || "Proctor@123", name: "Proctor 1", department: "Computer Science" },
  { email: `proctor2${domain}`, password: process.env.INITIAL_PROCTOR_PASSWORD || "Proctor@123", name: "Proctor 2", department: "Electronics" },
  ...Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return {
      email: `student${number}${domain}`,
      password: process.env.INITIAL_STUDENT_PASSWORD || "Student@123",
      name: `Student ${number}`,
      department: number <= 15 ? "Computer Science" : "Electronics",
      year_section: number % 2 === 0 ? "II / A" : "III / B",
    };
  }),
];

async function listExistingUsers() {
  const found = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) found.set(user.email?.toLowerCase(), user);
    if (data.users.length < 1000) return found;
  }
}

const existing = await listExistingUsers();
for (const account of users) {
  const oldUser = existing.get(account.email);
  if (oldUser) {
    console.log(`Already exists; left unchanged: ${account.email}`);
    continue;
  }

  const { error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: {
      full_name: account.name,
      department: account.department,
      ...(account.year_section ? { year_section: account.year_section } : {}),
    },
  });
  if (error) throw new Error(`Could not provision ${account.email}: ${error.message}`);
  console.log(`Created: ${account.email}`);
}

console.log("Done. The auth.users trigger provisions profiles and balances students across the two proctors.");
