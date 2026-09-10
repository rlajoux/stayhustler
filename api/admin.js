const { escapeHtml, csvCell } = require('./security');

function registerAdmin(app, { pool, orders, basicAuth, handle, adminPath }) {
    const ADMIN_PATH = adminPath;
function adminLayout(title, content) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${title} - StayHustler Admin</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 20px;
            background: #fafafa;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            margin: 0 0 10px;
            font-size: 28px;
            font-weight: 600;
        }
        .breadcrumb {
            margin-bottom: 20px;
            color: #666;
            font-size: 14px;
        }
        .breadcrumb a {
            color: #0066cc;
            text-decoration: none;
        }
        .breadcrumb a:hover {
            text-decoration: underline;
        }
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .card h2 {
            margin: 0 0 10px;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            color: #666;
            letter-spacing: 0.5px;
        }
        .card .number {
            font-size: 36px;
            font-weight: 600;
            margin-bottom: 10px;
        }
        .card .meta {
            font-size: 13px;
            color: #888;
        }
        .card a {
            display: inline-block;
            margin-top: 10px;
            color: #0066cc;
            text-decoration: none;
            font-size: 14px;
        }
        .card a:hover {
            text-decoration: underline;
        }
        .filters {
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .filters label {
            margin-right: 10px;
            font-size: 14px;
        }
        .filters select, .filters input {
            padding: 5px 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        .filters button {
            padding: 6px 15px;
            background: #0066cc;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .filters button:hover {
            background: #0052a3;
        }
        .filters a {
            margin-left: 15px;
            color: #0066cc;
            text-decoration: none;
            font-size: 14px;
        }
        .filters a:hover {
            text-decoration: underline;
        }
        table {
            width: 100%;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-collapse: collapse;
        }
        th {
            background: #f5f5f5;
            padding: 12px 15px;
            text-align: left;
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
            color: #666;
            letter-spacing: 0.5px;
        }
        td {
            padding: 12px 15px;
            border-top: 1px solid #eee;
            font-size: 14px;
        }
        tr:hover {
            background: #fafafa;
        }
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 500;
        }
        .badge-success {
            background: #d4edda;
            color: #155724;
        }
        .badge-danger {
            background: #f8d7da;
            color: #721c24;
        }
        .badge-secondary {
            background: #e2e3e5;
            color: #383d41;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
            font-size: 14px;
        }
        .pagination a {
            display: inline-block;
            padding: 8px 15px;
            margin: 0 5px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            color: #0066cc;
            text-decoration: none;
        }
        .pagination a:hover {
            background: #f5f5f5;
        }
        .pagination span {
            display: inline-block;
            padding: 8px 15px;
            margin: 0 5px;
        }
        .empty {
            text-align: center;
            padding: 40px;
            color: #999;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        ${content}
    </div>
</body>
</html>`;
}

// GET /admin - Dashboard

    app.get(ADMIN_PATH, basicAuth, handle(async (req, res) => {
        const stats = await orders.statistics();
        const content = '<h2>Orders paid in the last 24 hours</h2><dl>' + Object.entries(stats).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('') + '</dl><p>Amounts are in cents. Free orders are separate. Page views are not purchases.</p>';
        res.send(adminLayout('Overview', content));
    }));
    const lists = {
        subscribers: { table: 'newsletter_subscribers', columns: ['id','email','status','source','created_at'], statuses: ['subscribed','unsubscribed'] },
        deliveries: { table: 'orders', columns: ['id','email','payment_status','status','delivery_status','amount_cents','refund_cents','created_at'], statuses: ['pending','processing','ready','failed','refunded','expired'] }
    };
    for (const [name, config] of Object.entries(lists)) {
        const select = async req => {
            const status = req.query.status || '';
            if (status && !config.statuses.includes(status)) throw Object.assign(new Error('Invalid status filter'), { status: 400 });
            const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
            const values = status ? [status] : [];
            const where = status ? ' WHERE status=$1' : '';
            const count = Number((await pool.query(`SELECT COUNT(*) FROM ${config.table}${where}`, values)).rows[0].count);
            const rows = (await pool.query(`SELECT ${config.columns.join(',')} FROM ${config.table}${where} ORDER BY created_at DESC LIMIT 50 OFFSET $${values.length + 1}`, [...values, (page - 1) * 50])).rows;
            return { status, page, count, rows };
        };
        app.get(`${ADMIN_PATH}/${name}`, basicAuth, handle(async (req, res) => {
            const data = await select(req);
            const options = ['', ...config.statuses].map(status => `<option value="${status}" ${data.status === status ? 'selected' : ''}>${status || 'All'}</option>`).join('');
            const table = '<table><thead><tr>' + config.columns.map(column => `<th>${column}</th>`).join('') + '</tr></thead><tbody>' + data.rows.map(row => '<tr>' + config.columns.map(column => `<td>${escapeHtml(row[column] instanceof Date ? row[column].toISOString() : row[column])}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
            const pages = Math.max(1, Math.ceil(data.count / 50));
            const pageLink = page => `${ADMIN_PATH}/${name}?page=${page}&amp;status=${encodeURIComponent(data.status)}`;
            res.send(adminLayout(name, `<form><select name="status">${options}</select><button>Filter</button></form><p>${data.count} records. <a href="${ADMIN_PATH}/api/${name}.csv">Export CSV</a></p>${table}<p>Page ${data.page} of ${pages} ${data.page > 1 ? `<a href="${pageLink(data.page - 1)}">Previous</a>` : ''} ${data.page < pages ? `<a href="${pageLink(data.page + 1)}">Next</a>` : ''}</p>`));
        }));
        app.get(`${ADMIN_PATH}/api/${name}.csv`, basicAuth, handle(async (req, res) => {
            const rows = (await pool.query(`SELECT ${config.columns.join(',')} FROM ${config.table} ORDER BY created_at DESC LIMIT 10000`)).rows;
            res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
            res.type('csv').send([config.columns.map(csvCell).join(','), ...rows.map(row => config.columns.map(column => csvCell(row[column] instanceof Date ? row[column].toISOString() : row[column])).join(','))].join('\r\n'));
        }));
    }
}
module.exports = { registerAdmin };
