# Native Windows Installation — No Docker

## 1. Install prerequisites

Install:

1. Node.js LTS (Node 24 LTS recommended; Node >=20.9 required)
2. PostgreSQL 16+ and pgAdmin
3. Git (optional but recommended)

Verify in PowerShell:

```powershell
node -v
npm -v
psql --version
```

## 2. Create PostgreSQL database

In pgAdmin or psql create:

- Database: `nexuserp`
- User: `postgres` (local development is fine)
- Password: the password selected during PostgreSQL installation

Using psql:

```sql
CREATE DATABASE nexuserp;
```

## 3. Configure environment

From the project root:

```powershell
copy apps\api\.env.example apps\api\.env
copy apps\web\.env.local.example apps\web\.env.local
```

Edit `apps\api\.env` and set `DATABASE_URL` with your PostgreSQL password.

Example:

```env
DATABASE_URL="postgresql://postgres:YourPassword@localhost:5432/nexuserp?schema=public"
```

Keep:

```env
ZIMRA_MODE=mock
```

while developing locally.

## 4. Install and initialize

```powershell
npm install
npm run db:generate
npm run db:push
npm run db:seed
```

Or run:

```powershell
.\scripts\setup-windows.ps1
```

## 5. Start ERP

```powershell
npm run dev
```

Or:

```powershell
.\scripts\start-windows.ps1
```

Open:

- http://localhost:3000
- http://localhost:4000/docs

## 6. Login

Company administrator:
- Email: `admin@demo.local`
- Password: `Password123!`

Platform administrator:
- Email: `platform@demo.local`
- Password: `Password123!`

## 7. Test the fiscal flow

1. Login as company admin.
2. Open **Fiscalisation**.
3. Register the mock fiscal device.
4. Open a fiscal day.
5. Open **Sales > Invoices**.
6. Create and post an invoice.
7. Return to Fiscalisation and fiscalise the posted invoice.
8. Inspect the mock receipt and counters.
9. Close the fiscal day.

Nothing is transmitted to ZIMRA while `ZIMRA_MODE=mock`.

## Troubleshooting

### Prisma cannot connect
Check PostgreSQL is running and your `DATABASE_URL` password is correct.

### Port already in use
Change `PORT` in `apps/api/.env` or run the web on another port:

```powershell
npm run dev -w @nexuserp/web -- --port 3001
```

### Reset local database
WARNING: destroys local development data.

```powershell
npx prisma db push --force-reset --schema apps/api/prisma/schema.prisma
npm run db:seed
```
