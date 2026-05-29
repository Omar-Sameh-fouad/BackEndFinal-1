# CarePlus Pharmacy — Backend System Documentation

---

## 1. System Overview

### What Does the System Do?
- A **pharmacy management backend** (REST API) for a pharmacy named **CarePlus**.
- Manages medicines inventory, sales transactions, employee attendance, suppliers, users, and system security.
- Built with **Node.js + Express**, **MySQL** (via `mysql2/promise`), JWT authentication, and Joi validation.

### Main Modules & Features
- **Auth** — Login, first-admin creation, JWT issuance.
- **Users** — CRUD for pharmacy staff.
- **Medicines** — Inventory management with barcode search and external generic-name lookup.
- **Sales** — Point-of-sale with drug interaction detection, fractional quantity support, and profit tracking.
- **Suppliers** — Supplier management linked to medicines.
- **Attendance** — Employee check-in/check-out with working-hours enforcement.
- **System** — Notifications (low stock/expiry), reports (daily/historical), audit logs, daily closing with PIN, DB backup/restore.

### Main User Flows
- **Login flow:** POST `/api/login` → receive JWT → use token in `Authorization: Bearer <token>` header.
- **Sale flow:** Scan barcode → build items array → POST `/api/sales` → system checks drug interactions → if conflict returns 409 → cashier can force with `forceInteraction: true` → inventory deducted → sale recorded.
- **Attendance flow:** POST `/api/attendance/check-in` → work → POST `/api/attendance/check-out` (blocked if daily hours not completed).
- **Daily closing flow:** GET `/api/reports/today` → POST `/api/daily-closing` with PIN verification.
- **First-run flow:** POST `/api/create-first-admin` (only if no admin exists).

---

## 2. User Roles & Permissions

### `admin`
**Can do:**
- All CRUD on users, medicines, suppliers.
- Create first admin.
- View/manage audit logs.
- Setup and reset security PIN.
- Perform daily closing.
- Backup and restore database.
- View notifications and reports.
- Process check-in / check-out.
- Process sales.
- View attendance reports for any user.

**Cannot do:**
- No explicit restrictions beyond what all authenticated users share.

**Accessible endpoints:** All endpoints.

---

### `pharmacist`
**Can do:**
- View and manage medicines (add, edit, delete).
- View suppliers (add, delete).
- View users list.
- View notifications and reports.
- Process check-in / check-out.
- Process sales.

**Cannot do:**
- Create or edit users.
- Delete users.
- Access audit logs.
- Setup/reset security PIN.
- Perform daily closing.
- Backup or restore database.
- View attendance reports.

**Accessible endpoints:**
- `GET/POST/PUT/DELETE /api/medicines`
- `GET/POST/DELETE /api/suppliers`
- `GET /api/users`
- `POST /api/sales`
- `POST /api/attendance/check-in`, `check-out`
- `GET /api/notifications`
- `GET /api/reports/today`, `/reports/historical`
- `GET /api/security`

---

### `cashier`
**Can do:**
- Search medicines by barcode.
- Process sales.
- Check-in and check-out attendance.

**Cannot do:**
- View full medicines list.
- Add/edit/delete medicines.
- Manage users or suppliers.
- View reports or notifications.
- Access any admin/system endpoints.

**Accessible endpoints:**
- `GET /api/medicines/search/:barcode`
- `POST /api/sales`
- `POST /api/attendance/check-in`, `check-out`

---

### `delivery`
**Can do:**
- Defined in the validator as a valid role value.

**Cannot do:**
- Access any known endpoint (no route grants `delivery` role access).

> **Assumption (Low confidence):** `delivery` role may be reserved for future endpoints. Currently has no accessible routes.

---

## 3. Authentication & Authorization

### Login Rules
- Endpoint: `POST /api/login`
- Rate limited: **10 attempts per 15-minute window** per IP.
- Requires `username` and `password` in request body.
- Only **active users** (`active = 1`) can log in.
- Returns JWT token valid for **12 hours**.
- Password compared using **bcrypt**.
- Generic error message returned for both "user not found" and "wrong password" (prevents username enumeration).

### Registration Rules
- No public registration endpoint.
- First admin created via `POST /api/create-first-admin` — only works if **no admin exists yet**.
  - Default credentials: username `admin_user`, password `123456`.
- All subsequent users created by `admin` only via `POST /api/users`.

### JWT / Token Behavior
- Algorithm: Default HS256.
- Secret: `process.env.JWT_SECRET` or fallback `careplus_super_secret_key_2026` (hardcoded fallback is a security risk).
- Payload: `{ id, role, username }`.
- Expiry: `12h`.
- Passed via: `Authorization: Bearer <token>`.
- Expired or invalid token → `403 Forbidden`.
- Missing token → `401 Unauthorized`.

### Session Rules
- Stateless — no server-side session storage.
- No refresh token mechanism.
- Token invalidation (logout) not implemented server-side.

### Password Requirements
- Minimum **6 characters** (enforced by Joi on create).
- On update: password is optional; if sent, must still be ≥ 6 characters; empty string allowed (treated as no change).
- Hashed with **bcrypt, salt rounds = 10**.

### Role-Based Restrictions
- `verifyToken` middleware runs first, then `authorizeRoles(...roles)`.
- Unauthorized role → `403 Forbidden` with Arabic error message.

---

## 4. Validation Rules

### User (`POST /api/users`)
- `username`: string, min 3 chars, **required**.
- `fullName`: string, **required**.
- `email`: valid email format, optional, nullable.
- `phone`: digits only (`/^[0-9]+$/`), optional.
- `role`: must be one of `admin | pharmacist | delivery | cashier`, **required**.
- `password`: string, min 6 chars, **required**.
- `expectedDays`: integer, 1–31, optional.
- `dailyHours`: integer, 1–24, optional.

### Update User (`PUT /api/users/:id`)
- Same as above except:
  - `password`: optional, min 6 if provided, allows empty string/null.
  - `active`: must be `0` or `1`, optional.

### Medicine (`POST /api/medicines`)
- `name`: string, **required**.
- `barcode`: string, **required**, must be unique.
- `expiryDate`: ISO date format, **required**.
- `quantity`: number ≥ 0, **required**.
- `purchasePrice`: number ≥ 0, **required**.
- `sellingPrice`: number ≥ 0, **required**.
- `requiresPrescription`: boolean, optional.
- `supplierId`: string, optional, nullable.
- `pillCount`: integer ≥ 0, optional, nullable.
- `stripCount`: integer ≥ 0, optional, nullable.
- `manufacturer`: string, optional, nullable.
- `genericName`: string, optional, nullable.
- `medicineForm`: string, optional, nullable.

### Login
- `username`: string, **required**.
- `password`: string, **required**.

### Supplier
- `name`: string, **required**.
- `phones`: array of strings, optional.
- `address`: string, optional, nullable.

### Sale
- `paymentMethod`: one of `cash | card | wallet | insurance`, **required**.
- `forceInteraction`: boolean, optional, default `false`.
- `items`: array, min 1 item, **required**.
  - Each item: `medicineId` (string, required), `qty` (positive number, required), `quantityType` (`box | strip | pill`, required).

### Return Sale (schema defined, no active route in uploaded files)
- `saleId`: string, **required**.
- `returnedItems`: array, min 1, **required**.
  - Each: `saleItemId` (string), `qtyToReturn` (positive number).

---

## 5. Business Rules

| # | Rule | Confidence |
|---|------|-----------|
| 1 | A user cannot check in twice on the same calendar day. | High |
| 2 | A user cannot check out without first checking in on the same day. | High |
| 3 | Check-out is blocked if worked hours < `dailyHours` (default: 8). | High |
| 4 | Only one admin can be created via `/create-first-admin`; endpoint is disabled once an admin exists. | High |
| 5 | A medicine barcode must be unique across all medicines. | High |
| 6 | Sales deduct fractional inventory: `strip` divides by `stripCount`, `pill` divides by `pillCount`. | High |
| 7 | Inventory deduction is transactional — rolled back on any failure. | High |
| 8 | Drug interaction check compares generic names; only first word/stem of `genericName` is used. | High |
| 9 | If a drug interaction is detected and `forceInteraction` is `false`, sale returns 409 with warning. | High |
| 10 | If sale proceeds despite interaction (`forceInteraction: true`), an `AuditLog` entry is created with `severity = 'warning'`. | High |
| 11 | Daily closing requires valid PIN from `ManagerSecurity` table. | High |
| 12 | PIN reset requires providing the old PIN. | High |
| 13 | Deleting a medicine linked to sales is blocked (`ER_ROW_IS_REFERENCED_2`). | High |
| 14 | Deleting a supplier linked to medicines is blocked (`ER_ROW_IS_REFERENCED_2`). | High |
| 15 | Inactive users (`active = 0`) cannot log in. | High |
| 16 | Medicines with quantity ≤ 10 or expiry ≤ 30 days trigger notifications. | High |
| 17 | Quantity = 0 triggers an **urgent** low-stock alert. | High |
| 18 | Drug interaction database is currently a **mock in-memory object** (only aspirin-warfarin and ibuprofen-aspirin). | High |
| 19 | Sale profit = `sellingPrice × deductedQty − purchasePrice × deductedQty` per item, summed. | High |
| 20 | Attendance report covers the **current calendar month** only. | High |
| 21 | `expectedDays` defaults to 24 in attendance report if not set. | High |
| 22 | `dailyHours` defaults to 8 in checkout enforcement if not set. | High |
| 23 | DB backup exports full schema + data as SQL dump, disabling foreign key checks during restore. | High |
| 24 | `delivery` role has no functional access to any endpoint. | Medium |

---

## 6. API Documentation

### Auth

#### `POST /api/login`
- **Purpose:** Authenticate user and receive JWT.
- **Required fields:** `username`, `password`
- **Rate limit:** 10 req / 15 min
- **Success:** `200` — `{ message, token, user }` (password excluded from user object)
- **Errors:** `400` invalid schema | `401` wrong credentials | `429` rate limit exceeded | `500` server error
- **Auth:** None

#### `POST /api/create-first-admin`
- **Purpose:** Seed first admin user if none exists.
- **Required fields:** None (hardcoded credentials)
- **Success:** `200` — `{ message }` with credentials `admin_user / 123456`
- **Errors:** `400` admin already exists | `500` server error
- **Auth:** None

---

### Users

#### `GET /api/users`
- **Purpose:** List all users (passwords excluded).
- **Auth:** `admin`, `pharmacist`

#### `POST /api/users`
- **Purpose:** Create a new employee.
- **Required fields:** `username`, `fullName`, `role`, `password`
- **Success:** `200` — `{ message }`
- **Errors:** `400` duplicate username/phone | `400` validation error | `500`
- **Auth:** `admin`

#### `PUT /api/users/:id`
- **Purpose:** Update employee data (optionally reset password).
- **Required fields:** `username`, `fullName`, `role` (others optional)
- **Errors:** `404` user not found | `400` validation | `500`
- **Auth:** `admin`

#### `DELETE /api/users/:id`
- **Purpose:** Hard-delete an employee.
- **Errors:** `404` not found | `500`
- **Auth:** `admin`

---

### Medicines

#### `GET /api/medicines`
- **Purpose:** Paginated medicines list.
- **Query params:** `page` (default 1), `limit` (default 50)
- **Success:** `200` — `{ data, pagination }`
- **Auth:** `admin`, `pharmacist`

#### `GET /api/medicines/search/:barcode`
- **Purpose:** Find medicine by barcode.
- **Success:** `200` — medicine object
- **Errors:** `404` not found
- **Auth:** `admin`, `pharmacist`, `cashier`

#### `POST /api/medicines`
- **Purpose:** Add new medicine to inventory.
- **Required fields:** `name`, `barcode`, `expiryDate`, `quantity`, `purchasePrice`, `sellingPrice`
- **Errors:** `400` duplicate barcode | `400` validation | `500`
- **Auth:** `admin`, `pharmacist`

#### `PUT /api/medicines/:id`
- **Purpose:** Update existing medicine (partial update supported).
- **Errors:** `404` not found | `400` duplicate barcode | `400` no fields sent | `500`
- **Auth:** `admin`, `pharmacist`

#### `DELETE /api/medicines/:id`
- **Purpose:** Remove medicine from inventory.
- **Errors:** `404` not found | `400` linked to sales | `500`
- **Auth:** `admin`, `pharmacist`

#### `GET /api/medicines/generic-suggestions?term=`
- **Purpose:** Autocomplete generic drug names via NLM RxTerms API.
- **Query params:** `term` (min 2 chars)
- **Errors:** `504` external API timeout | `500` connection failure
- **Auth:** `admin`, `pharmacist`

---

### Suppliers

#### `GET /api/suppliers`
- **Auth:** `admin`, `pharmacist`

#### `POST /api/suppliers`
- **Required fields:** `name`
- **Auth:** `admin`, `pharmacist`

#### `DELETE /api/suppliers/:id`
- **Errors:** `404` not found | `400` linked to medicines
- **Auth:** `admin`, `pharmacist`

---

### Sales

#### `POST /api/sales`
- **Purpose:** Create a sale transaction.
- **Required fields:** `paymentMethod`, `items[]` (each with `medicineId`, `qty`, `quantityType`)
- **Optional:** `forceInteraction: true`
- **Success:** `200` — `{ message, saleId, total, interactionsWarning }`
- **Errors:** `409` drug interaction detected | `400` insufficient stock or medicine not found | `400` validation | `500`
- **Auth:** `admin`, `pharmacist`, `cashier`
- **Notes:** Full DB transaction; rolled back on any error.

---

### Attendance

#### `POST /api/attendance/check-in`
- **Body:** `{ username }`
- **Errors:** `400` already checked in | `404` user not found | `500`
- **Auth:** `admin`, `pharmacist`, `cashier`

#### `POST /api/attendance/check-out`
- **Body:** `{ username }`
- **Errors:** `400` already checked out | `400` no check-in today | `400` hours not completed (with remaining time shown) | `404` user not found | `500`
- **Auth:** `admin`, `pharmacist`, `cashier`

#### `GET /api/attendance/report/:userId`
- **Purpose:** Monthly attendance report for a specific user.
- **Success:** `{ userName, fullName, dailyHours, expectedDays, actualDaysWorked, attendanceRate }`
- **Errors:** `404` user not found | `500`
- **Auth:** `admin`

---

### System

#### `GET /api/notifications`
- **Purpose:** Alerts for low stock and near-expiry medicines.
- **Auth:** `admin`, `pharmacist`

#### `GET /api/reports/today`
- **Purpose:** Today's sales totals grouped by payment method.
- **Auth:** `admin`, `pharmacist`

#### `GET /api/reports/historical?range=`
- **Query params:** `range` = `day | week | month`
- **Auth:** `admin`, `pharmacist`

#### `GET /api/security`
- **Purpose:** Check if security PIN is set up.
- **Auth:** `admin`, `pharmacist`

#### `POST /api/security/setup`
- **Body:** `{ pin, recoveryEmail, recoveryPhone }`
- **Auth:** `admin`

#### `POST /api/security/reset-pin`
- **Body:** `{ oldPin, newPin }`
- **Auth:** `admin`

#### `POST /api/daily-closing`
- **Body:** `{ date, totals, grandTotal, salesCount, closedByName, closedById, pin }`
- **Errors:** `401` PIN not set up | `401` wrong PIN
- **Auth:** `admin`, `pharmacist`

#### `POST /api/logs`
- **Purpose:** Manually insert an audit log entry.
- **Body:** `{ actorId, actorName, action, details, severity }`
- **Auth:** `admin`

#### `GET /api/logs`
- **Purpose:** Paginated audit log list.
- **Query params:** `page`, `limit`
- **Auth:** `admin`

#### `GET /api/backup`
- **Purpose:** Download full SQL dump of all tables.
- **Response:** `application/octet-stream` file download.
- **Auth:** `admin`

#### `POST /api/restore`
- **Purpose:** Restore DB from uploaded SQL file.
- **Body:** `multipart/form-data`, field `backup` (SQL file).
- **Auth:** `admin`

---

## 7. Database Constraints

### Inferred from Code

| Table | Field | Constraint |
|-------|-------|-----------|
| `User` | `username` | UNIQUE |
| `User` | `phone` | UNIQUE |
| `User` | `active` | DEFAULT 1 |
| `User` | `dailyHours` | DEFAULT 8 (app-level) |
| `User` | `expectedDays` | DEFAULT 24 (app-level) |
| `Medicine` | `barcode` | UNIQUE |
| `Medicine` | `supplierId` | FK → `Supplier.id` |
| `Sale` | `cashierId` | FK → `User.id` |
| `SaleItem` | `saleId` | FK → `Sale.id` |
| `SaleItem` | `medicineId` | FK → `Medicine.id` |
| `Attendance` | `userId` | FK → `User.id` |
| `ManagerSecurity` | `id` | Hardcoded as `"1"` (singleton row) |
| `AuditLog` | `id` | UUID, PK |

### Behaviors
- `Medicine` deletion blocked if referenced by `SaleItem` (`ER_ROW_IS_REFERENCED_2`).
- `Supplier` deletion blocked if referenced by `Medicine`.
- DB pool configured with `multipleStatements: true` (required for restore; potential SQL injection risk if misused).
- Sales use `beginTransaction / commit / rollback` — fully atomic.
- Backup uses `SET FOREIGN_KEY_CHECKS=0` to allow restoration in any order.

---

## 8. Edge Cases

- **Duplicate check-in:** Returns `400` — correctly handled.
- **Check-out without check-in:** Returns `400` — correctly handled.
- **Insufficient medicine stock during sale:** Transaction rolls back for all items.
- **Sale with medicine ID not found:** Throws inline, triggers rollback.
- **`forceInteraction` not sent:** Defaults to `false` via Joi default — interaction blocks sale.
- **`pillCount` or `stripCount` is 0 or null when `quantityType` is `pill`/`strip`:** `calculateFractionalQty` falls back to `qty` (no division by zero), but deduction is incorrect.
- **`dailyHours` not set on user:** Defaults to `8` hours at check-out.
- **`expectedDays` not set:** Defaults to `24` in attendance report.
- **Generic name with dosage info** (e.g., `Aspirin 500mg`): Code strips numeric dosage before comparison — partially handles this.
- **First-admin endpoint left open:** No authentication required; exploitable if not disabled post-setup.
- **Backup endpoint** sends entire DB as plain SQL to any authenticated admin — no size limits.
- **Restore endpoint** executes raw SQL from uploaded file — **critical security risk** if admin account is compromised.
- **Token after user deactivation:** A deactivated user (`active = 0`) cannot log in again, but **an existing valid token continues to work** for up to 12 hours.
- **Hardcoded JWT fallback secret:** If `JWT_SECRET` env var is not set, the fallback is public in source code.
- **`delivery` role:** Can be assigned to a user but cannot access any API endpoint.
- **`/api/medicines/generic-suggestions`** calls external NLM API — failure returns `504` but does not affect core functionality.
- **`ManagerSecurity` PIN row is hardcoded `id = "1"`:** Only one security profile supported system-wide.

---

## 9. Testing Insights

### Critical Test Scenarios
- [ ] Login with correct credentials → JWT issued, password not in response.
- [ ] Login with wrong password → `401`, no user data leaked.
- [ ] Rate limit: 11th login attempt within 15 minutes → `429`.
- [ ] Access protected endpoint without token → `401`.
- [ ] Access endpoint with expired token → `403`.
- [ ] Cashier attempts to access `GET /api/medicines` → `403`.
- [ ] Create sale with insufficient stock → `400`, inventory unchanged.
- [ ] Create sale with drug interaction, `forceInteraction: false` → `409`.
- [ ] Create sale with drug interaction, `forceInteraction: true` → `200`, AuditLog entry created.
- [ ] Check-in twice on same day → `400`.
- [ ] Check-out before completing daily hours → `400` with time remaining.
- [ ] First-admin creation when admin exists → `400`.
- [ ] Delete medicine linked to a sale → `400`.
- [ ] Delete supplier linked to a medicine → `400`.

### High-Risk Areas
- **`POST /api/restore`** — executes arbitrary SQL from file upload; no content validation.
- **Hardcoded JWT secret** — tokens can be forged if secret is known.
- **`multipleStatements: true`** on DB pool — increases SQL injection surface.
- **Active token after deactivation** — 12-hour window where deactivated users retain access.
- **`calculateFractionalQty`** with `pillCount = 0` — silent incorrect deduction.
- **Drug interaction mock database** — only 2 interactions checked; real pharmacy use requires real data.

### Security Test Ideas
- [ ] Send SQL injection payloads in `username`, `barcode`, `medicineId` fields.
- [ ] Upload malicious SQL file to `/api/restore`.
- [ ] Forge a JWT with `role: "admin"` using the known fallback secret.
- [ ] Try accessing `/api/create-first-admin` after admin is created.
- [ ] Attempt path traversal in restore file upload.
- [ ] Send oversized payload to backup/restore endpoints.
- [ ] Test CORS: send requests from non-whitelisted origin.
- [ ] Replay an expired token — should return `403`.

### Negative Test Cases
- [ ] `POST /api/medicines` with `quantity: -1` → `400`.
- [ ] `POST /api/sales` with empty `items` array → `400`.
- [ ] `POST /api/sales` with `quantityType: "invalid"` → `400`.
- [ ] `PUT /api/users/:id` with no body fields → should update with provided values (no partial protection on PUT).
- [ ] `GET /api/medicines/generic-suggestions?term=a` (1 char) → `[]` empty array, no external call.
- [ ] Check-out with `stripCount = 0` and `quantityType = "strip"` → incorrect deduction (bug).
- [ ] `POST /api/attendance/check-in` without `username` in body → `400`.

---

## 10. Assumptions

| # | Assumption | Reason |
|---|-----------|--------|
| 1 | `ReturnSale` table and return-sale route exist but were not uploaded. | `returnSale` schema is defined in `validator.js` but no router file was provided. |
| 2 | `AuditLog`, `DailyClosing`, `ManagerSecurity`, `Attendance`, `SaleItem`, `Sale`, `Medicine`, `User`, `Supplier` tables exist in MySQL with the inferred schema. | No SQL migration file provided. |
| 3 | `delivery` role is planned but not yet implemented. | Role appears in validator but no endpoint allows it. |
| 4 | `Sale.ts` column name is `ts` (used in queries as `DATE(ts) = CURDATE()`). | Inferred from SQL queries in `system.js`; no schema file to confirm. |
| 5 | The external NLM RxTerms API is used only for autocomplete and is non-critical to sales. | Timeout returns `504` gracefully; no blocking logic depends on it. |
| 6 | `ManagerSecurity` is a singleton table (one row, `id = "1"`). | All queries hardcode `WHERE id = "1"`. Multi-pharmacy/multi-branch not supported. |
| 7 | `Attendance` does not enforce that the `username` in the body matches the JWT token user. | Code queries by `username` from body, not from `req.user`. Any authenticated user can clock in/out for another user. |