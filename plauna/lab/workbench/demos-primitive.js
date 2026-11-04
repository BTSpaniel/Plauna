// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab demos: modal, dropdown, card, avatar, breadcrumb, pagination, progress, skeleton, layout.
 * Split out of lab/workbench-lab.js.
 */

import { uniformDistribution } from '../../../engine/core/math/MathRandom.js';
import { widgetStyleManager } from '../../widgets/WidgetStyleManager.js';

export function createDemoModal(type, modalId, toastManager) {
    const modalConfigs = {
        default: {
            title: 'Demo Modal',
            content: 'This is a demonstration of the Modal widget with focus trapping and accessibility features.',
            size: 'md',
            variant: 'default'
        },
        warning: {
            title: 'Warning',
            content: 'This is a warning modal with a different variant styling. Important information is displayed here.',
            size: 'sm',
            variant: 'warning'
        },
        large: {
            title: 'Large Modal',
            content: 'This is a large modal that can contain more content. It demonstrates the size variants available in the Modal widget. You can put forms, lists, or any other content here.',
            size: 'lg',
            variant: 'default'
        }
    };
    
    const config = modalConfigs[type] || modalConfigs.default;
    
    // Create modal using theme-based styling
    const modalStyles = widgetStyleManager.getWidgetStyles('modal');
    const modalElement = widgetStyleManager.createStyledElement('div', modalStyles.overlay, 'plauna-demo-modal');
    modalElement.id = modalId;
    
    const sizeStyles = {
        sm: { width: '320px', minHeight: '160px' },
        md: { width: '500px', minHeight: '280px' },
        lg: { width: '700px', minHeight: '400px' }
    };
    
    const modalPanel = widgetStyleManager.createStyledElement('div', modalStyles.panel);
    
    // Apply size-specific styles
    if (sizeStyles[config.size]) {
        widgetStyleManager.applyStyles(modalPanel, {
            width: sizeStyles[config.size].width,
            minHeight: sizeStyles[config.size].minHeight
        });
    }
    
    // Header
    const header = widgetStyleManager.createStyledElement('header', modalStyles.header);
    
    const title = widgetStyleManager.createStyledElement('h2', modalStyles.title);
    title.textContent = config.title;
    
    const closeButton = widgetStyleManager.createStyledElement('button', modalStyles.closeButton);
    closeButton.innerHTML = '×';
    
    closeButton.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(closeButton, modalStyles.closeButtonHover);
    });
    
    closeButton.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(closeButton, { backgroundColor: 'transparent', color: '#94a3b8' });
    });
    
    closeButton.addEventListener('click', () => closeModal());
    
    header.appendChild(title);
    header.appendChild(closeButton);
    
    // Content
    const content = widgetStyleManager.createStyledElement('div', modalStyles.content);
    content.textContent = config.content;
    
    modalPanel.appendChild(header);
    modalPanel.appendChild(content);
    modalElement.appendChild(modalPanel);
    
    // Add to DOM
    document.body.appendChild(modalElement);
    
    // Modal functions
    function openModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '1' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(1)' });
        toastManager.show(`${config.title} modal opened`, 'info');
    }
    
    function closeModal() {
        widgetStyleManager.applyStyles(modalElement, { opacity: '0' });
        widgetStyleManager.applyStyles(modalPanel, { transform: 'scale(0.95)' });
        setTimeout(() => {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
        }, 200);
    }
    
    // Close on backdrop click
    modalElement.addEventListener('click', (e) => {
        if (e.target === modalElement) {
            closeModal();
        }
    });
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Store reference
    modalElement.open = openModal;
    modalElement.close = closeModal;
    
    // Open immediately
    openModal();
}

export function createDemoDropdown(type, triggerButton) {
    const dropdownConfigs = {
        actions: {
            items: [
                { label: 'Copy', icon: '📋', shortcut: 'Ctrl+C', action: () => console.log('Copy action') },
                { label: 'Paste', icon: '📄', shortcut: 'Ctrl+V', action: () => console.log('Paste action') },
                { label: 'Cut', icon: '✂️', shortcut: 'Ctrl+X', action: () => console.log('Cut action') },
                { type: 'divider' },
                { label: 'Delete', icon: '🗑️', shortcut: 'Del', action: () => console.log('Delete action') }
            ]
        },
        options: {
            items: [
                { label: 'Settings', icon: '⚙️', action: () => console.log('Settings') },
                { label: 'Preferences', icon: '🎨', action: () => console.log('Preferences') },
                { label: 'Help', icon: '❓', action: () => console.log('Help') },
                { type: 'divider' },
                { label: 'About', icon: 'ℹ️', action: () => console.log('About') }
            ]
        },
        context: {
            items: [
                { label: 'View', icon: '👁️', action: () => console.log('View') },
                { label: 'Edit', icon: '✏️', action: () => console.log('Edit') },
                { label: 'Share', icon: '🔗', action: () => console.log('Share') },
                { type: 'divider' },
                { label: 'Properties', icon: '📊', action: () => console.log('Properties') }
            ]
        }
    };
    
    const config = dropdownConfigs[type] || dropdownConfigs.actions;
    
    // Create dropdown using theme-based styling
    const dropdownStyles = widgetStyleManager.getWidgetStyles('dropdown');
    const dropdownElement = widgetStyleManager.createStyledElement('div', dropdownStyles.container, 'plauna-demo-dropdown');
    
    // Create menu items
    config.items.forEach(item => {
        if (item.type === 'divider') {
            const divider = widgetStyleManager.createStyledElement('div', dropdownStyles.divider);
            dropdownElement.appendChild(divider);
        } else {
            const menuItem = widgetStyleManager.createStyledElement('div', dropdownStyles.menuItem);
            
            const content = widgetStyleManager.createStyledElement('div', dropdownStyles.menuItemContent);
            
            if (item.icon) {
                const icon = widgetStyleManager.createStyledElement('span', dropdownStyles.icon);
                icon.textContent = item.icon;
                content.appendChild(icon);
            }
            
            const label = document.createElement('span');
            label.textContent = item.label;
            content.appendChild(label);
            
            menuItem.appendChild(content);
            
            if (item.shortcut) {
                const shortcut = widgetStyleManager.createStyledElement('span', dropdownStyles.shortcut);
                shortcut.textContent = item.shortcut;
                content.appendChild(shortcut);
            }
            
            menuItem.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(menuItem, dropdownStyles.menuItemHover);
            });
            
            menuItem.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(menuItem, { backgroundColor: 'transparent' });
            });
            
            menuItem.addEventListener('click', () => {
                if (item.action) {
                    item.action(item);
                }
                closeDropdown();
            });
            
            dropdownElement.appendChild(menuItem);
        }
    });
    
    // Add to DOM
    document.body.appendChild(dropdownElement);
    
    // Position dropdown
    const rect = triggerButton.getBoundingClientRect();
    const dropdownRect = dropdownElement.getBoundingClientRect();
    
    let top = rect.bottom + 4;
    let left = rect.left;
    
    // Adjust if dropdown would go outside viewport
    if (top + dropdownRect.height > window.innerHeight - 10) {
        top = rect.top - dropdownRect.height - 4;
    }
    if (left + dropdownRect.width > window.innerWidth - 10) {
        left = window.innerWidth - dropdownRect.width - 10;
    }
    if (left < 10) {
        left = 10;
    }
    
    dropdownElement.style.top = `${top + window.pageYOffset}px`;
    dropdownElement.style.left = `${left + window.pageXOffset}px`;
    
    // Dropdown functions
    function openDropdown() {
        widgetStyleManager.applyStyles(dropdownElement, {
            opacity: '1',
            transform: 'scale(1) translateY(0)'
        });
    }
    
    function closeDropdown() {
        widgetStyleManager.applyStyles(dropdownElement, {
            opacity: '0',
            transform: 'scale(0.95) translateY(-8px)'
        });
        setTimeout(() => {
            if (dropdownElement.parentNode) {
                dropdownElement.parentNode.removeChild(dropdownElement);
            }
        }, 150);
    }
    
    // Close on outside click
    const outsideClickHandler = (e) => {
        if (!dropdownElement.contains(e.target) && !triggerButton.contains(e.target)) {
            closeDropdown();
            document.removeEventListener('click', outsideClickHandler);
        }
    };
    document.addEventListener('click', outsideClickHandler);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeDropdown();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    // Open immediately
    openDropdown();
}

export function createDemoCard(type, triggerButton, toastManager) {
    const cardConfigs = {
        product: {
            title: 'Premium Widget',
            content: 'Experience the power of Plauna with our premium widget collection. Built with performance and accessibility in mind.',
            image: 'https://picsum.photos/seed/plauna/300/200.jpg',
            price: '$29.99'
        },
        profile: {
            title: 'John Doe',
            content: 'Senior UI Engineer passionate about creating beautiful and accessible user interfaces.',
            image: 'https://picsum.photos/seed/avatar/100/100.jpg',
            status: 'Available for hire'
        },
        elevated: {
            title: 'Featured Card',
            content: 'This card showcases the elevated variant with enhanced shadows and visual depth.',
            image: 'https://picsum.photos/seed/elevated/300/180.jpg'
        }
    };
    
    const config = cardConfigs[type] || cardConfigs.product;
    
    // Create card using theme-based styling
    const cardStyles = widgetStyleManager.getWidgetStyles('card');
    const cardElement = widgetStyleManager.createStyledElement('div', cardStyles.container, 'plauna-demo-card');
    
    // Image
    if (config.image) {
        const image = widgetStyleManager.createStyledElement('img', cardStyles.image);
        image.src = config.image;
        cardElement.appendChild(image);
    }
    
    // Content
    const content = widgetStyleManager.createStyledElement('div', cardStyles.content);
    
    // Title
    const title = widgetStyleManager.createStyledElement('h3', cardStyles.title);
    title.textContent = config.title;
    content.appendChild(title);
    
    // Description
    const description = widgetStyleManager.createStyledElement('p', cardStyles.description);
    description.textContent = config.content;
    content.appendChild(description);
    
    // Footer
    if (config.price || config.status) {
        const footer = widgetStyleManager.createStyledElement('div', cardStyles.footer);
        
        if (config.price) {
            const price = widgetStyleManager.createStyledElement('span', cardStyles.price);
            price.textContent = config.price;
            footer.appendChild(price);
        }
        
        if (config.status) {
            const status = widgetStyleManager.createStyledElement('span', cardStyles.status);
            status.textContent = config.status;
            footer.appendChild(status);
        }
        
        content.appendChild(footer);
    }
    
    cardElement.appendChild(content);
    
    // Add to DOM
    document.body.appendChild(cardElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(cardElement, {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)'
        });
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!cardElement.contains(e.target)) {
                closeCard();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeCard();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeCard() {
        widgetStyleManager.applyStyles(cardElement, {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.9)'
        });
        setTimeout(() => {
            if (cardElement.parentNode) {
                cardElement.parentNode.removeChild(cardElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} card displayed`, 'info');
}

export function createDemoAvatar(type, triggerButton, toastManager) {
    const avatarConfigs = {
        image: {
            src: 'https://picsum.photos/seed/avatar/100/100.jpg',
            name: 'Sarah Johnson',
            status: 'online'
        },
        initials: {
            name: 'Michael Chen',
            status: 'busy'
        },
        status: {
            name: 'Emily Davis',
            status: 'away',
            showStatus: true
        }
    };
    
    const config = avatarConfigs[type] || avatarConfigs.image;
    
    // Create avatar using theme-based styling
    const avatarStyles = widgetStyleManager.getWidgetStyles('avatar');
    const avatarElement = widgetStyleManager.createStyledElement('div', avatarStyles.container, 'plauna-demo-avatar');
    
    // Avatar image/initials
    const avatarImage = widgetStyleManager.createStyledElement('div', avatarStyles.image);
    
    if (config.src) {
        widgetStyleManager.applyStyles(avatarImage, {
            backgroundImage: `url(${config.src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
        });
    } else {
        avatarImage.textContent = config.name.split(' ').map(n => n[0]).join('').toUpperCase();
    }
    
    avatarElement.appendChild(avatarImage);
    
    // Status indicator
    if (config.showStatus !== false && config.status) {
        const status = widgetStyleManager.createStyledElement('div', avatarStyles.status);
        widgetStyleManager.applyStyles(status, {
            background: getStatusColor(config.status)
        });
        avatarElement.appendChild(status);
    }
    
    // Name
    const name = widgetStyleManager.createStyledElement('div', avatarStyles.name);
    name.textContent = config.name;
    avatarElement.appendChild(name);
    
    // Status text
    const statusText = widgetStyleManager.createStyledElement('div', avatarStyles.statusText);
    statusText.textContent = config.status;
    avatarElement.appendChild(statusText);
    
    // Add to DOM
    document.body.appendChild(avatarElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(avatarElement, {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)'
        });
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!avatarElement.contains(e.target)) {
                closeAvatar();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeAvatar();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeAvatar() {
        widgetStyleManager.applyStyles(avatarElement, {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.9)'
        });
        setTimeout(() => {
            if (avatarElement.parentNode) {
                avatarElement.parentNode.removeChild(avatarElement);
            }
        }, 200);
    }
    
    function getStatusColor(status) {
        const colors = {
            online: '#10b981',
            offline: '#64748b',
            busy: '#ef4444',
            away: '#f59e0b'
        };
        return colors[status] || '#64748b';
    }
    
    toastManager.show(`${config.name} avatar displayed`, 'info');
}

export function createDemoBreadcrumb(type, triggerButton, toastManager) {
    const breadcrumbConfigs = {
        file: {
            items: ['root', 'documents', 'projects', 'plauna', 'widgets', 'Card.js']
        },
        site: {
            items: ['Home', 'Products', 'Widgets', 'Card Component']
        },
        category: {
            items: ['UI Components', 'Layout', 'Cards', 'Product Cards']
        }
    };
    
    const config = breadcrumbConfigs[type] || breadcrumbConfigs.file;
    
    // Create breadcrumb using theme-based styling
    const breadcrumbStyles = widgetStyleManager.getWidgetStyles('breadcrumb');
    const breadcrumbElement = widgetStyleManager.createStyledElement('div', breadcrumbStyles.container, 'plauna-demo-breadcrumb');
    
    // Create breadcrumb items
    config.items.forEach((item, index) => {
        const isLast = index === config.items.length - 1;
        const itemElement = widgetStyleManager.createStyledElement('div', isLast ? breadcrumbStyles.itemLast : breadcrumbStyles.item);
        itemElement.textContent = item;
        
        if (!isLast) {
            itemElement.addEventListener('click', () => {
                toastManager.show(`Navigate to: ${item}`, 'info');
            });
            
            itemElement.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(itemElement, breadcrumbStyles.itemHover);
            });
            
            itemElement.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(itemElement, { color: '#3b82f6' });
            });
        }
        
        breadcrumbElement.appendChild(itemElement);
        
        // Add separator if not last
        if (!isLast) {
            const separator = widgetStyleManager.createStyledElement('span', breadcrumbStyles.separator);
            separator.textContent = '/';
            breadcrumbElement.appendChild(separator);
        }
    });
    
    // Add to DOM
    document.body.appendChild(breadcrumbElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(breadcrumbElement, breadcrumbStyles.visible);
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!breadcrumbElement.contains(e.target)) {
                closeBreadcrumb();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeBreadcrumb();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeBreadcrumb() {
        widgetStyleManager.applyStyles(breadcrumbElement, breadcrumbStyles.hidden);
        setTimeout(() => {
            if (breadcrumbElement.parentNode) {
                breadcrumbElement.parentNode.removeChild(breadcrumbElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} breadcrumb displayed`, 'info');
}

export function createDemoPagination(type, triggerButton, toastManager) {
    const paginationConfigs = {
        standard: {
            currentPage: 3,
            totalPages: 10,
            showItemsPerPage: true
        },
        compact: {
            currentPage: 5,
            totalPages: 20,
            showItemsPerPage: false
        },
        jump: {
            currentPage: 7,
            totalPages: 50,
            showJumpToPage: true
        }
    };
    
    const config = paginationConfigs[type] || paginationConfigs.standard;
    
    // Create pagination using theme-based styling
    const paginationStyles = widgetStyleManager.getWidgetStyles('pagination');
    const paginationElement = widgetStyleManager.createStyledElement('div', paginationStyles.container, 'plauna-demo-pagination');
    
    // Previous button
    const prevBtn = widgetStyleManager.createStyledElement('button', paginationStyles.button);
    prevBtn.textContent = '←';
    
    prevBtn.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(prevBtn, paginationStyles.buttonHover);
    });
    
    prevBtn.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(prevBtn, { background: '#3b82f6' });
    });
    
    paginationElement.appendChild(prevBtn);
    
    // Page numbers
    const startPage = Math.max(1, config.currentPage - 2);
    const endPage = Math.min(config.totalPages, config.currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === config.currentPage;
        const pageBtn = widgetStyleManager.createStyledElement('button', isActive ? paginationStyles.buttonActive : paginationStyles.button);
        pageBtn.textContent = i;
        
        if (!isActive) {
            pageBtn.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(pageBtn, paginationStyles.buttonHover);
            });
            
            pageBtn.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(pageBtn, { background: 'transparent', color: '#e4e4e7' });
            });
        }
        
        paginationElement.appendChild(pageBtn);
    }
    
    // Next button
    const nextBtn = widgetStyleManager.createStyledElement('button', paginationStyles.button);
    nextBtn.textContent = '→';
    
    nextBtn.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(nextBtn, paginationStyles.buttonHover);
    });
    
    nextBtn.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(nextBtn, { background: '#3b82f6' });
    });
    
    paginationElement.appendChild(nextBtn);
    
    // Add to DOM
    document.body.appendChild(paginationElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(paginationElement, paginationStyles.visible);
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!paginationElement.contains(e.target)) {
                closePagination();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closePagination();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closePagination() {
        widgetStyleManager.applyStyles(paginationElement, paginationStyles.hidden);
        setTimeout(() => {
            if (paginationElement.parentNode) {
                paginationElement.parentNode.removeChild(paginationElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} pagination displayed`, 'info');
}

export function createDemoProgress(type, triggerButton, toastManager) {
    const progressConfigs = {
        linear: {
            type: 'linear',
            value: 75,
            variant: 'default'
        },
        circular: {
            type: 'circular',
            value: 60,
            variant: 'success'
        },
        indeterminate: {
            type: 'linear',
            indeterminate: true,
            variant: 'info'
        }
    };
    
    const config = progressConfigs[type] || progressConfigs.linear;
    
    // Create progress as a simple DOM element for demo
    const progressElement = document.createElement('div');
    progressElement.className = 'plauna-demo-progress';
    progressElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 116, 141, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        padding: 24px;
        z-index: 1000;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.9);
        transition: all 200ms ease;
        backdrop-filter: blur(4px);
        min-width: 300px;
    `;
    
    // Title
    const title = document.createElement('div');
    title.textContent = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Progress`;
    title.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 16px;
        text-align: center;
    `;
    progressElement.appendChild(title);
    
    // Progress bar
    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 12px;
    `;
    
    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
        height: 100%;
        width: ${config.indeterminate ? '30%' : config.value + '%'};
        background: ${config.variant === 'success' ? '#10b981' : config.variant === 'info' ? '#06b6d4' : '#3b82f6'};
        border-radius: 4px;
        transition: width 300ms ease;
        ${config.indeterminate ? 'animation: progressIndeterminate 1.5s ease-in-out infinite;' : ''}
    `;
    
    progressBar.appendChild(progressFill);
    progressElement.appendChild(progressBar);
    
    // Percentage
    const percentage = document.createElement('div');
    percentage.textContent = config.indeterminate ? 'Loading...' : `${config.value}%`;
    percentage.style.cssText = `
        text-align: center;
        font-size: 14px;
        color: #94a3b8;
    `;
    progressElement.appendChild(percentage);
    
    // Add CSS animation for indeterminate
    if (config.indeterminate) {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes progressIndeterminate {
                0% { margin-left: -30%; }
                60% { margin-left: 100%; }
                100% { margin-left: 100%; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add to DOM
    document.body.appendChild(progressElement);
    
    // Animate in
    requestAnimationFrame(() => {
        progressElement.style.opacity = '1';
        progressElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Animate progress
    if (!config.indeterminate) {
        setTimeout(() => {
            progressFill.style.width = '90%';
            percentage.textContent = '90%';
        }, 500);
    }
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!progressElement.contains(e.target)) {
                closeProgress();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeProgress();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeProgress() {
        progressElement.style.opacity = '0';
        progressElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (progressElement.parentNode) {
                progressElement.parentNode.removeChild(progressElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.type} progress displayed`, 'info');
}

export function createDemoSkeleton(type, triggerButton, toastManager) {
    const skeletonConfigs = {
        text: {
            type: 'text',
            lines: 3
        },
        avatar: {
            type: 'avatar',
            size: 'md'
        },
        paragraph: {
            type: 'paragraph',
            lines: 4
        }
    };
    
    const config = skeletonConfigs[type] || skeletonConfigs.text;
    
    // Create skeleton as a simple DOM element for demo
    const skeletonElement = document.createElement('div');
    skeletonElement.className = 'plauna-demo-skeleton';
    skeletonElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 116, 141, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        padding: 24px;
        z-index: 1000;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.9);
        transition: all 200ms ease;
        backdrop-filter: blur(4px);
        min-width: 300px;
    `;
    
    // Title
    const title = document.createElement('div');
    title.textContent = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Skeleton`;
    title.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 20px;
        text-align: center;
    `;
    skeletonElement.appendChild(title);
    
    // Create skeleton content
    if (config.type === 'avatar') {
        const avatar = document.createElement('div');
        avatar.style.cssText = `
            width: 60px;
            height: 60px;
            background: linear-gradient(90deg, rgba(255, 255, 255, 0.1) 25%, transparent 50%, rgba(255, 255, 255, 0.1) 75%);
            background-size: 200% 200%;
            border-radius: 50%;
            margin: 0 auto;
            animation: skeletonShimmer 1.5s ease-in-out infinite;
        `;
        skeletonElement.appendChild(avatar);
    } else {
        // Create text skeleton lines
        for (let i = 0; i < config.lines; i++) {
            const line = document.createElement('div');
            const width = Math.floor(uniformDistribution(60, 100, Math.random)); // 60-99%
            line.style.cssText = `
                height: 16px;
                width: ${width}%;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.1) 25%, transparent 50%, rgba(255, 255, 255, 0.1) 75%);
                background-size: 200% 200%;
                border-radius: 4px;
                margin-bottom: 8px;
                animation: skeletonShimmer 1.5s ease-in-out infinite;
            `;
            skeletonElement.appendChild(line);
        }
    }
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes skeletonShimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }
    `;
    document.head.appendChild(style);
    
    // Add to DOM
    document.body.appendChild(skeletonElement);
    
    // Animate in
    requestAnimationFrame(() => {
        skeletonElement.style.opacity = '1';
        skeletonElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!skeletonElement.contains(e.target)) {
                closeSkeleton();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSkeleton();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSkeleton() {
        skeletonElement.style.opacity = '0';
        skeletonElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (skeletonElement.parentNode) {
                skeletonElement.parentNode.removeChild(skeletonElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.type} skeleton displayed`, 'info');
}

export function createDemoLayout(type, triggerButton, toastManager) {
    const layoutConfigs = {
        grid: {
            type: 'grid',
            columns: 3,
            gap: '16px'
        },
        divider: {
            type: 'divider',
            orientation: 'horizontal',
            label: 'Section Divider'
        },
        spacer: {
            type: 'spacer',
            size: 'lg',
            direction: 'vertical'
        }
    };
    
    const config = layoutConfigs[type] || layoutConfigs.grid;
    
    // Create layout demo as a simple DOM element for demo
    const layoutElement = document.createElement('div');
    layoutElement.className = 'plauna-demo-layout';
    layoutElement.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(99, 116, 141, 0.3);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        padding: 24px;
        z-index: 1000;
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.9);
        transition: all 200ms ease;
        backdrop-filter: blur(4px);
        min-width: 400px;
    `;
    
    // Title
    const title = document.createElement('div');
    title.textContent = `${config.type.charAt(0).toUpperCase() + config.type.slice(1)} Layout`;
    title.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        color: #e4e4e7;
        margin-bottom: 20px;
        text-align: center;
    `;
    layoutElement.appendChild(title);
    
    // Create layout content
    if (config.type === 'grid') {
        const grid = document.createElement('div');
        grid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(${config.columns}, 1fr);
            gap: ${config.gap};
            margin-bottom: 16px;
        `;
        
        // Add grid items
        for (let i = 0; i < 6; i++) {
            const item = document.createElement('div');
            item.style.cssText = `
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid #3b82f6;
                border-radius: 4px;
                padding: 12px;
                color: #e4e4e7;
                text-align: center;
                font-size: 14px;
            `;
            item.textContent = `Grid Item ${i + 1}`;
            grid.appendChild(item);
        }
        
        layoutElement.appendChild(grid);
    } else if (config.type === 'divider') {
        const divider = document.createElement('div');
        divider.style.cssText = `
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 20px 0;
        `;
        
        const line1 = document.createElement('div');
        line1.style.cssText = `
            flex: 1;
            height: 1px;
            background: #64748b;
        `;
        divider.appendChild(line1);
        
        if (config.label) {
            const label = document.createElement('div');
            label.textContent = config.label;
            label.style.cssText = `
                color: #94a3b8;
                font-size: 14px;
            `;
            divider.appendChild(label);
        }
        
        const line2 = document.createElement('div');
        line2.style.cssText = `
            flex: 1;
            height: 1px;
            background: #64748b;
        `;
        divider.appendChild(line2);
        
        layoutElement.appendChild(divider);
    } else if (config.type === 'spacer') {
        const spacer = document.createElement('div');
        spacer.style.cssText = `
            display: flex;
            flex-direction: ${config.direction === 'vertical' ? 'column' : 'row'};
            align-items: center;
            gap: 8px;
        `;
        
        // Add spacers
        for (let i = 0; i < 3; i++) {
            const space = document.createElement('div');
            space.style.cssText = `
                ${config.direction === 'vertical' ? 'height' : 'width'}: ${config.size === 'lg' ? '24px' : '16px'};
                background: rgba(99, 116, 141, 0.2);
                border: 1px dashed #64748b;
                border-radius: 4px;
            `;
            spacer.appendChild(space);
        }
        
        layoutElement.appendChild(spacer);
    }
    
    // Add to DOM
    document.body.appendChild(layoutElement);
    
    // Animate in
    requestAnimationFrame(() => {
        layoutElement.style.opacity = '1';
        layoutElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!layoutElement.contains(e.target)) {
                closeLayout();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeLayout();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeLayout() {
        layoutElement.style.opacity = '0';
        layoutElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (layoutElement.parentNode) {
                layoutElement.parentNode.removeChild(layoutElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.type} layout displayed`, 'info');
}
