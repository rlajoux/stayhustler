#!/usr/bin/env node
/**
 * Environment Variable Diagnostic Script
 * Run this on Railway to check if all required variables are set
 * 
 * Usage: node check_env.js
 */

require('dotenv').config();

const checks = {
    '🔧 Core API': {
        'GEMINI_API_KEY': process.env.GEMINI_API_KEY,
        'SENDGRID_API_KEY': process.env.SENDGRID_API_KEY,
        'SENDGRID_FROM_EMAIL': process.env.SENDGRID_FROM_EMAIL,
    },
    '🗄️ Database': {
        'DATABASE_URL': process.env.DATABASE_URL,
    },
    '🔐 Security': {
        'UNSUBSCRIBE_SECRET': process.env.UNSUBSCRIBE_SECRET,
    },
    '👤 Admin Area': {
        'ADMIN_USER': process.env.ADMIN_USER,
        'ADMIN_PASS': process.env.ADMIN_PASS,
        'ADMIN_PATH': process.env.ADMIN_PATH || '/admin (default)',
    },
    '⚙️ General': {
        'NODE_ENV': process.env.NODE_ENV,
        'PORT': process.env.PORT || '3000 (default)',
        'ALLOWED_ORIGIN': process.env.ALLOWED_ORIGIN,
    }
};

console.log('\n' + '='.repeat(60));
console.log('📋 STAYHUSTLER ENVIRONMENT DIAGNOSTIC');
console.log('='.repeat(60) + '\n');

let allGood = true;
const criticalMissing = [];

for (const [category, vars] of Object.entries(checks)) {
    console.log(`\n${category}`);
    console.log('-'.repeat(60));
    
    for (const [key, value] of Object.entries(vars)) {
        const isCritical = ['GEMINI_API_KEY', 'SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL', 'DATABASE_URL'].includes(key);
        
        if (value && value !== 'undefined') {
            // Mask sensitive values
            const masked = key.includes('KEY') || key.includes('PASS') || key.includes('SECRET')
                ? '***' + value.slice(-4)
                : value;
            
            console.log(`  ✅ ${key.padEnd(25)} ${masked}`);
        } else {
            const status = isCritical ? '❌ MISSING (CRITICAL)' : '⚠️  Not set (optional)';
            console.log(`  ${status.padEnd(25)} ${key}`);
            
            if (isCritical) {
                allGood = false;
                criticalMissing.push(key);
            }
        }
    }
}

console.log('\n' + '='.repeat(60));

if (allGood) {
    console.log('✅ ALL CRITICAL ENVIRONMENT VARIABLES ARE SET');
    console.log('\nYour application should be working correctly.');
    console.log('\nNext steps:');
    console.log('  1. Test generation: POST /api/generate-request');
    console.log('  2. Test email: POST /api/deliver-request');
    console.log('  3. Check admin panel: ' + (process.env.ADMIN_PATH || '/admin'));
} else {
    console.log('❌ MISSING CRITICAL ENVIRONMENT VARIABLES');
    console.log('\nThe following variables MUST be set for the app to work:');
    criticalMissing.forEach(key => {
        console.log(`  - ${key}`);
    });
    console.log('\nAdd these in Railway dashboard → Variables tab');
    console.log('\nSee api/.env.example for reference values');
}

console.log('\n' + '='.repeat(60));

// Test API connectivity
async function testAPIs() {
    console.log('\n🔍 TESTING API CONNECTIVITY\n');
    
    // Test Gemini
    if (process.env.GEMINI_API_KEY) {
        try {
            console.log('Testing Gemini API...');
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'Say "Hello"' }] }]
                    })
                }
            );
            
            if (response.ok) {
                console.log('  ✅ Gemini API: Working');
            } else {
                console.log(`  ❌ Gemini API: Error ${response.status}`);
                const text = await response.text();
                console.log(`     ${text.slice(0, 100)}`);
            }
        } catch (err) {
            console.log(`  ❌ Gemini API: ${err.message}`);
        }
    } else {
        console.log('  ⏭️  Gemini API: Skipped (no API key)');
    }
    
    // Test SendGrid
    if (process.env.SENDGRID_API_KEY) {
        try {
            console.log('\nTesting SendGrid API...');
            const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
                headers: {
                    'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`
                }
            });
            
            if (response.ok) {
                console.log('  ✅ SendGrid API: Working');
            } else {
                console.log(`  ❌ SendGrid API: Error ${response.status}`);
            }
        } catch (err) {
            console.log(`  ❌ SendGrid API: ${err.message}`);
        }
    } else {
        console.log('\n  ⏭️  SendGrid API: Skipped (no API key)');
    }
    
    // Test Database
    if (process.env.DATABASE_URL) {
        try {
            console.log('\nTesting Database connection...');
            const { Pool } = require('pg');
            const pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
            
            await pool.query('SELECT NOW()');
            console.log('  ✅ Database: Connected');
            await pool.end();
        } catch (err) {
            console.log(`  ❌ Database: ${err.message}`);
        }
    } else {
        console.log('\n  ⏭️  Database: Skipped (no DATABASE_URL)');
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
}

// Run tests
testAPIs().catch(err => {
    console.error('Error running API tests:', err);
});
