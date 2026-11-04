// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab demos: table, tree, list.
 * Split out of lab/workbench-lab.js.
 */


export function createDemoTable(type, triggerButton, toastManager) {
    const tableConfigs = {
        default: {
            columns: [
                { key: 'id', label: 'ID', sortable: true },
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'status', label: 'Status', sortable: true }
            ],
            data: [
                { id: 1, name: 'John Doe', email: 'john@example.com', status: 'Active' },
                { id: 2, name: 'Jane Smith', email: 'jane@example.com', status: 'Inactive' },
                { id: 3, name: 'Bob Johnson', email: 'bob@example.com', status: 'Active' },
                { id: 4, name: 'Alice Brown', email: 'alice@example.com', status: 'Pending' },
                { id: 5, name: 'Charlie Wilson', email: 'charlie@example.com', status: 'Active' }
            ]
        },
        primary: {
            columns: [
                { key: 'product', label: 'Product', sortable: true },
                { key: 'price', label: 'Price', sortable: true },
                { key: 'stock', label: 'Stock', sortable: true }
            ],
            data: [
                { product: 'Laptop', price: '$999', stock: 15 },
                { product: 'Phone', price: '$699', stock: 23 },
                { product: 'Tablet', price: '$399', stock: 8 }
            ]
        },
        selectable: {
            columns: [
                { key: 'task', label: 'Task', sortable: true },
                { key: 'priority', label: 'Priority', sortable: true },
                { key: 'due', label: 'Due Date', sortable: true }
            ],
            data: [
                { task: 'Complete project', priority: 'High', due: '2024-01-15' },
                { task: 'Review code', priority: 'Medium', due: '2024-01-20' },
                { task: 'Update docs', priority: 'Low', due: '2024-01-25' }
            ],
            selectable: true
        }
    };
    
    const config = tableConfigs[type] || tableConfigs.default;
    
    // Create table as a simple DOM element for demo
    const tableElement = document.createElement('div');
    tableElement.className = 'plauna-demo-table';
    tableElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'max-height: 500px;' +
        'overflow: auto;'
    );
    
    // Create table
    const table = document.createElement('table');
    table.style.cssText = (
        'width: 100%;' +
        'border-collapse: collapse;' +
        'font-size: 14px;'
    );
    
    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.style.cssText = (
        'background: rgba(59, 130, 246, 0.1);' +
        'border-bottom: 2px solid rgba(59, 130, 246, 0.3);'
    );
    
    config.columns.forEach(column => {
        const th = document.createElement('th');
        th.textContent = column.label;
        th.style.cssText = (
            'padding: 12px;' +
            'text-align: left;' +
            'font-weight: 600;' +
            'color: #3b82f6;' +
            'border-bottom: 1px solid rgba(99, 116, 141, 0.2);' +
            'cursor: ' + (column.sortable ? 'pointer' : 'default') + ';'
        );
        
        if (column.sortable) {
            th.addEventListener('click', () => {
                toastManager.show(`Sort by ${column.label}`, 'info');
            });
        }
        
        headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create body
    const tbody = document.createElement('tbody');
    
    config.data.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.style.cssText = (
            'border-bottom: 1px solid rgba(99, 116, 141, 0.1);' +
            'transition: background 150ms ease;' +
            'cursor: ' + (config.selectable ? 'pointer' : 'default') + ';'
        );
        
        if (config.selectable) {
            tr.addEventListener('click', () => {
                tr.style.background = tr.style.background === 'rgba(59, 130, 246, 0.1)' ? 'transparent' : 'rgba(59, 130, 246, 0.1)';
                toastManager.show(`Row ${index + 1} selected`, 'info');
            });
            
            tr.addEventListener('mouseenter', () => {
                if (tr.style.background !== 'rgba(59, 130, 246, 0.1)') {
                    tr.style.background = 'rgba(255, 255, 255, 0.05)';
                }
            });
            
            tr.addEventListener('mouseleave', () => {
                if (tr.style.background !== 'rgba(59, 130, 246, 0.1)') {
                    tr.style.background = 'transparent';
                }
            });
        }
        
        config.columns.forEach(column => {
            const td = document.createElement('td');
            td.textContent = row[column.key];
            td.style.cssText = (
                'padding: 12px;' +
                'color: #e4e4e7;' +
                'border-bottom: 1px solid rgba(99, 116, 141, 0.1);'
            );
            tr.appendChild(td);
        });
        
        tbody.appendChild(tr);
    });
    
    table.appendChild(tbody);
    tableElement.appendChild(table);
    
    // Add to DOM
    document.body.appendChild(tableElement);
    
    // Animate in
    requestAnimationFrame(() => {
        tableElement.style.opacity = '1';
        tableElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!tableElement.contains(e.target)) {
                closeTable();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeTable();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeTable() {
        tableElement.style.opacity = '0';
        tableElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (tableElement.parentNode) {
                tableElement.parentNode.removeChild(tableElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} table displayed`, 'info');
}

export function createDemoTree(type, triggerButton, toastManager) {
    const treeConfigs = {
        default: {
            data: [
                {
                    id: '1',
                    label: 'Documents',
                    icon: '📁',
                    children: [
                        { id: '1-1', label: 'Report.pdf', icon: '📄' },
                        { id: '1-2', label: 'Presentation.pptx', icon: '📊' }
                    ]
                },
                {
                    id: '2',
                    label: 'Projects',
                    icon: '📁',
                    children: [
                        {
                            id: '2-1',
                            label: 'Website',
                            icon: '📁',
                            children: [
                                { id: '2-1-1', label: 'index.html', icon: '🌐' },
                                { id: '2-1-2', label: 'styles.css', icon: '🎨' }
                            ]
                        },
                        { id: '2-2', label: 'Mobile App', icon: '📱' }
                    ]
                },
                { id: '3', label: 'README.md', icon: '📝' }
            ]
        },
        selectable: {
            data: [
                {
                    id: 'root',
                    label: 'Root Folder',
                    icon: '📁',
                    children: [
                        { id: 'item1', label: 'File 1', icon: '📄' },
                        { id: 'item2', label: 'File 2', icon: '📄' }
                    ]
                }
            ],
            selectable: true
        }
    };
    
    const config = treeConfigs[type] || treeConfigs.default;
    
    // Create tree as a simple DOM element for demo
    const treeElement = document.createElement('div');
    treeElement.className = 'plauna-demo-tree';
    treeElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;' +
        'max-width: 400px;'
    );
    
    // Create tree container
    const treeContainer = document.createElement('div');
    treeContainer.style.cssText = (
        'font-size: 14px;' +
        'color: #e4e4e7;'
    );
    
    // Create tree nodes
    function createTreeNode(node, level = 0) {
        const hasChildren = node.children && node.children.length > 0;
        const nodeElement = document.createElement('div');
        nodeElement.style.cssText = (
            'margin-left: ' + (level * 20) + 'px;' +
            'padding: 4px 8px;' +
            'cursor: ' + (config.selectable ? 'pointer' : 'default') + ';' +
            'border-radius: 4px;' +
            'transition: background 150ms ease;'
        );
        
        // Add expand/collapse icon
        if (hasChildren) {
            const expandIcon = document.createElement('span');
            expandIcon.textContent = '▶';
            expandIcon.style.cssText = (
                'display: inline-block;' +
                'width: 12px;' +
                'font-size: 10px;' +
                'color: #94a3b8;' +
                'margin-right: 4px;' +
                'cursor: pointer;' +
                'transition: transform 150ms ease;'
            );
            
            let isExpanded = false;
            expandIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                isExpanded = !isExpanded;
                expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
                childrenContainer.style.display = isExpanded ? 'block' : 'none';
            });
            
            nodeElement.appendChild(expandIcon);
        } else {
            const spacer = document.createElement('span');
            spacer.style.cssText = (
                'display: inline-block;' +
                'width: 16px;'
            );
            nodeElement.appendChild(spacer);
        }
        
        // Add node icon
        if (node.icon) {
            const icon = document.createElement('span');
            icon.textContent = node.icon;
            icon.style.cssText = (
                'margin-right: 8px;' +
                'font-size: 14px;'
            );
            nodeElement.appendChild(icon);
        }
        
        // Add node label
        const label = document.createElement('span');
        label.textContent = node.label;
        label.style.cssText = (
            'color: inherit;' +
            'font-weight: 500;'
        );
        nodeElement.appendChild(label);
        
        // Add hover effect
        nodeElement.addEventListener('mouseenter', () => {
            nodeElement.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        
        nodeElement.addEventListener('mouseleave', () => {
            nodeElement.style.background = 'transparent';
        });
        
        // Add click handler for selectable trees
        if (config.selectable) {
            nodeElement.addEventListener('click', () => {
                toastManager.show(`Selected: ${node.label}`, 'info');
            });
        }
        
        // Add children container
        let childrenContainer = null;
        if (hasChildren) {
            childrenContainer = document.createElement('div');
            childrenContainer.style.display = 'none';
            
            node.children.forEach(child => {
                const childElement = createTreeNode(child, level + 1);
                childrenContainer.appendChild(childElement);
            });
        }
        
        const container = document.createElement('div');
        container.appendChild(nodeElement);
        if (childrenContainer) {
            container.appendChild(childrenContainer);
        }
        
        return container;
    }
    
    // Create tree root
    config.data.forEach(node => {
        const treeNode = createTreeNode(node);
        treeContainer.appendChild(treeNode);
    });
    
    treeElement.appendChild(treeContainer);
    
    // Add to DOM
    document.body.appendChild(treeElement);
    
    // Animate in
    requestAnimationFrame(() => {
        treeElement.style.opacity = '1';
        treeElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!treeElement.contains(e.target)) {
                closeTree();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeTree();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeTree() {
        treeElement.style.opacity = '0';
        treeElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (treeElement.parentNode) {
                treeElement.parentNode.removeChild(treeElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} tree displayed`, 'info');
}

export function createDemoList(type, triggerButton, toastManager) {
    const listConfigs = {
        default: {
            items: [
                { label: 'First item', badge: 'New' },
                { label: 'Second item', icon: '📌' },
                { label: 'Third item', action: { label: 'View' } },
                { label: 'Fourth item', badge: '5' },
                { label: 'Fifth item', icon: '⭐', badge: 'Popular' }
            ]
        },
        ordered: {
            items: [
                { label: 'Step 1: Setup project' },
                { label: 'Step 2: Install dependencies' },
                { label: 'Step 3: Run tests' },
                { label: 'Step 4: Deploy application' }
            ],
            ordered: true
        },
        horizontal: {
            items: [
                { label: 'React', icon: '⚛️' },
                { label: 'Vue', icon: '💚' },
                { label: 'Angular', icon: '🅰️' },
                { label: 'Svelte', icon: '🔥' }
            ],
            horizontal: true
        }
    };
    
    const config = listConfigs[type] || listConfigs.default;
    
    // Create list as a simple DOM element for demo
    const listElement = document.createElement('div');
    listElement.className = 'plauna-demo-list';
    listElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 24px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 300px;' +
        'max-width: 400px;'
    );
    
    // Create list container
    const listContainer = document.createElement('div');
    listContainer.style.cssText = (
        'display: ' + (config.horizontal ? 'flex' : 'block') + ';' +
        'gap: 8px;' +
        'flex-wrap: ' + (config.horizontal ? 'wrap' : 'nowrap') + ';'
    );
    
    // Create list items
    config.items.forEach((item, index) => {
        const listItem = document.createElement('div');
        listItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: 8px;' +
            'padding: 8px 12px;' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border: 1px solid rgba(99, 116, 141, 0.2);' +
            'border-radius: 8px;' +
            'color: #e4e4e7;' +
            'font-size: 14px;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        // Add list number if ordered
        if (config.ordered) {
            const number = document.createElement('span');
            number.textContent = (index + 1) + '.';
            number.style.cssText = (
                'font-weight: bold;' +
                'color: #3b82f6;' +
                'margin-right: 4px;'
            );
            listItem.appendChild(number);
        }
        
        // Add icon if present
        if (item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 16px;'
            );
            listItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = (
            'flex: 1;' +
            'color: inherit;'
        );
        listItem.appendChild(label);
        
        // Add badge if present
        if (item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: #3b82f6;' +
                'color: white;' +
                'font-size: 10px;' +
                'font-weight: bold;' +
                'padding: 2px 6px;' +
                'border-radius: 4px;' +
                'margin-left: 8px;'
            );
            listItem.appendChild(badge);
        }
        
        // Add action if present
        if (item.action) {
            const actionButton = document.createElement('button');
            actionButton.textContent = item.action.label;
            actionButton.style.cssText = (
                'background: transparent;' +
                'color: #3b82f6;' +
                'border: 1px solid #3b82f6;' +
                'border-radius: 4px;' +
                'padding: 2px 6px;' +
                'font-size: 10px;' +
                'cursor: pointer;' +
                'margin-left: 8px;'
            );
            
            actionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                toastManager.show(`Action: ${item.action.label}`, 'info');
            });
            
            listItem.appendChild(actionButton);
        }
        
        // Add hover effect
        listItem.addEventListener('mouseenter', () => {
            listItem.style.background = 'rgba(255, 255, 255, 0.1)';
            listItem.style.transform = 'translateY(-1px)';
        });
        
        listItem.addEventListener('mouseleave', () => {
            listItem.style.background = 'rgba(255, 255, 255, 0.05)';
            listItem.style.transform = 'translateY(0)';
        });
        
        // Add click handler
        listItem.addEventListener('click', () => {
            toastManager.show(`Selected: ${item.label}`, 'info');
        });
        
        listContainer.appendChild(listItem);
    });
    
    listElement.appendChild(listContainer);
    
    // Add to DOM
    document.body.appendChild(listElement);
    
    // Animate in
    requestAnimationFrame(() => {
        listElement.style.opacity = '1';
        listElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!listElement.contains(e.target)) {
                closeList();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeList();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeList() {
        listElement.style.opacity = '0';
        listElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (listElement.parentNode) {
                listElement.parentNode.removeChild(listElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} list displayed`, 'info');
}
