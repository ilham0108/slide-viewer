const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { DEFAULT_ROLES } = require('../config/permissions');
const logger = require('../utils/logger');

const log = logger.child('server');
const DEFAULT_ADMIN_PASSWORD = 'admin123';

// MySQL 5.7 has no "ADD COLUMN IF NOT EXISTS", so check information_schema first.
async function addMissingColumns(connection, table, columns) {
    const [rows] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [table]
    );
    const existing = new Set(rows.map(row => row.COLUMN_NAME));
    for (const [name, definition] of Object.entries(columns)) {
        if (!existing.has(name)) {
            await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
        }
    }
}

async function addMissingForeignKeys(connection, table, constraints) {
    const [rows] = await connection.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [table]
    );
    const existing = new Set(rows.map(row => row.CONSTRAINT_NAME));
    for (const [name, definition] of Object.entries(constraints)) {
        if (!existing.has(name)) {
            await connection.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${definition}`);
        }
    }
}

async function seedRolesAndAdmin(connection) {
    const [[{ roleCount }]] = await connection.query('SELECT COUNT(*) AS roleCount FROM roles');
    if (roleCount === 0) {
        for (const role of DEFAULT_ROLES) {
            const [result] = await connection.query(
                'INSERT INTO roles (name, description, is_system) VALUES (?, ?, ?)',
                [role.name, role.description, role.isSystem]
            );
            if (role.permissions.length) {
                await connection.query(
                    'INSERT INTO role_permissions (role_id, permission) VALUES ?',
                    [role.permissions.map(permission => [result.insertId, permission])]
                );
            }
        }
        log.info('Default roles created', { roles: DEFAULT_ROLES.map(role => role.name) });
    }

    const [[{ userCount }]] = await connection.query('SELECT COUNT(*) AS userCount FROM users');
    if (userCount > 0) return;

    const [[adminRole]] = await connection.query('SELECT id FROM roles WHERE is_system = 1 ORDER BY id LIMIT 1');
    const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
    await connection.query(
        'INSERT INTO users (username, name, password_hash, role_id) VALUES (?, ?, ?, ?)',
        ['admin', 'Administrator', await bcrypt.hash(password, 10), adminRole.id]
    );
    if (process.env.ADMIN_PASSWORD) {
        log.info('Initial user "admin" created with the password from ADMIN_PASSWORD');
    } else {
        log.warn(`Initial user "admin" created with the default password "${DEFAULT_ADMIN_PASSWORD}". Change it after the first login.`);
    }
}

async function initializeDatabase() {
    const connection = await pool.getConnection();
    try {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS roles (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(255) NULL,
                is_system TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_roles_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                role_id INT UNSIGNED NOT NULL,
                permission VARCHAR(64) NOT NULL,
                PRIMARY KEY (role_id, permission),
                CONSTRAINT fk_role_permissions_role
                    FOREIGN KEY (role_id) REFERENCES roles(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                username VARCHAR(64) NOT NULL,
                name VARCHAR(150) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role_id INT UNSIGNED NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_login_at TIMESTAMP NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_users_username (username),
                CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                description VARCHAR(255) NULL,
                color CHAR(7) NOT NULL DEFAULT '#2563eb',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_categories_name (name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS cases (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                case_number VARCHAR(64) NOT NULL,
                title VARCHAR(255) NOT NULL,
                category_id INT UNSIGNED NULL,
                status ENUM('open', 'in_review', 'closed') NOT NULL DEFAULT 'open',
                description TEXT NULL,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_cases_case_number (case_number),
                KEY idx_cases_category (category_id),
                CONSTRAINT fk_cases_category FOREIGN KEY (category_id) REFERENCES categories(id),
                CONSTRAINT fk_cases_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS slides (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                stored_name VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                source_name VARCHAR(255) NULL,
                status ENUM('processing', 'ready', 'failed') NOT NULL DEFAULT 'processing',
                progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
                magnification SMALLINT UNSIGNED NULL,
                mpp DOUBLE NULL,
                error_message TEXT NULL,
                case_id INT UNSIGNED NULL,
                uploaded_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_slides_stored_name (stored_name),
                KEY idx_slides_status_created (status, created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await addMissingColumns(connection, 'slides', {
            source_name: 'VARCHAR(255) NULL AFTER original_name',
            progress: 'TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER status',
            case_id: 'INT UNSIGNED NULL AFTER error_message',
            uploaded_by: 'INT UNSIGNED NULL AFTER case_id',
            // Only used while the slide is in no case; a case's category wins otherwise.
            category_id: 'INT UNSIGNED NULL AFTER case_id',
            // Micrometres per pixel from the slide file; NULL means the viewer estimates it.
            mpp: 'DOUBLE NULL AFTER magnification',
        });
        // Deleting a case is refused while it has slides; SET NULL is only a safety net.
        await addMissingForeignKeys(connection, 'slides', {
            fk_slides_case: 'FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL',
            fk_slides_uploaded_by: 'FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL',
            fk_slides_category: 'FOREIGN KEY (category_id) REFERENCES categories(id)',
        });
        await connection.query(`
            CREATE TABLE IF NOT EXISTS slide_annotations (
                slide_id BIGINT UNSIGNED NOT NULL,
                annotations JSON NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (slide_id),
                CONSTRAINT fk_slide_annotations_slide
                    FOREIGN KEY (slide_id) REFERENCES slides(id)
                    ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS share_links (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                resource_type ENUM('slide', 'case', 'category', 'compare', 'slides', 'cases') NOT NULL,
                resource_id BIGINT UNSIGNED NULL,
                title VARCHAR(255) NOT NULL,
                view_state JSON NULL,
                password_hash VARCHAR(255) NULL,
                expires_at TIMESTAMP NULL,
                hide_clinical TINYINT(1) NOT NULL DEFAULT 0,
                show_annotations TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT UNSIGNED NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                revoked_at TIMESTAMP NULL,
                view_count INT UNSIGNED NOT NULL DEFAULT 0,
                last_viewed_at TIMESTAMP NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_share_links_token (token),
                KEY idx_share_links_created_by (created_by),
                CONSTRAINT fk_share_links_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key VARCHAR(64) NOT NULL,
                setting_value TEXT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (setting_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Revision counter for optimistic locking: annotations can be edited by several people.
        await addMissingColumns(connection, 'slide_annotations', {
            revision: 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER annotations',
        });
        await addMissingColumns(connection, 'share_links', {
            allow_annotation_edit: 'TINYINT(1) NOT NULL DEFAULT 0 AFTER show_annotations',
        });
        // Tables created before the multi-item share types existed get the extra values.
        await connection.query(
            "ALTER TABLE share_links MODIFY resource_type ENUM('slide', 'case', 'category', 'compare', 'slides', 'cases') NOT NULL"
        );
        await seedRolesAndAdmin(connection);
    } finally {
        connection.release();
    }
}

module.exports = {
    initializeDatabase,
};
