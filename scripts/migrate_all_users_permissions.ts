import dotenv from 'dotenv';
dotenv.config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { prisma } from '../src/database/prisma';

async function migrateUsers() {
    console.log('Fetching all users from database...');
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} user accounts in database:`);
    users.forEach(u => console.log(` - ID: ${u.id}, Username: "${u.user_name}", Role: "${u.role}", Administrate: ${u.administrate}`));

    for (const user of users) {
        const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.administrate === true;
        const userMode: 'VIEW' | 'EDIT' = user.modify_access === 'VIEW' ? 'VIEW' : 'EDIT';

        let systemAccess: string[] = [];
        let pageAccess: Record<string, 'VIEW' | 'EDIT'> = {};

        if (isSuperAdmin) {
            systemAccess = ['ALL'];
            pageAccess = { ALL: 'EDIT' };
        } else {
            const pageMap: Record<string, boolean> = {
                admin_users: !!user.administrate,
                create_indent: !!user.create_indent,
                indent_approval: !!(user.indent_approval_view || user.indent_approval_action),
                pending_indents: !!user.pending_indents_view,
                create_po: !!user.create_po,
                orders_view: !!(user.orders_view || user.po_history),
                inventory_stock: !!user.inventory,
                store_issue: !!user.store_issue,
                store_issue_return: !!user.store_issue_return,
                issue_data: !!user.issue_data,
                vendor_update: !!(user.update_vendor_view || user.update_vendor_action),
                technical_approval: !!(user.three_party_approval_view || user.three_party_approval_action),
                management_approval: !!(user.three_party_approval_view || user.three_party_approval_action),
                store_in: !!user.store_in,
                hod_store_approval: !!user.hod_store_approval,
                grn_rejection: !!user.instead_of_quality_check_in_received_item,
                bill_pending: !!user.bill_not_received,
                make_payment: !!user.make_payment,
                freight_payment: !!user.full_kiting,
                debit_note: !!user.send_debit_note,
                audit_data: !!(user.audit_data || user.again_auditing || user.reaudit_data),
                tally_entry: !!user.take_entry_by_telly,
                pc_report: !!user.db_for_pc,
                master_registry: !!user.administrate,
                working_calendar: !!user.administrate,
                holidays: !!user.administrate,
            };

            let hasStoreAccess = false;
            Object.entries(pageMap).forEach(([pageId, hasAccess]) => {
                if (hasAccess) {
                    hasStoreAccess = true;
                    pageAccess[pageId] = userMode;
                }
            });

            if (hasStoreAccess) {
                systemAccess.push('store');
            }

            if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
                systemAccess.push('checklist');
                pageAccess['checklist_dash'] = userMode;
                pageAccess['checklist_quick_task'] = userMode;
                pageAccess['checklist_assign'] = userMode;
                pageAccess['checklist_submit_checklist'] = userMode;
                pageAccess['checklist_submit_delegation'] = userMode;
                pageAccess['checklist_approval'] = userMode;
            }
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                system_access: systemAccess,
                page_access: pageAccess,
            },
        });

        console.log(`\nUpdated user "${user.user_name}" (ID: ${user.id}):`);
        console.log(`  system_access:`, JSON.stringify(systemAccess));
        console.log(`  page_access:`, JSON.stringify(pageAccess, null, 2));
    }

    console.log('\nMigration completed successfully!');
}

migrateUsers()
    .catch((err) => {
        console.error('Migration failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
