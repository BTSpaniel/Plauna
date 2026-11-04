// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab demos: menu, navbar, sidebar, stepper.
 * Split out of lab/workbench-lab.js.
 */


export function createDemoMenu(type, triggerButton, toastManager) {
    // Define tokens for demo use (since we're not importing the full Plauna system)
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const menuConfigs = {
        default: {
            orientation: 'vertical',
            variant: 'default',
            size: 'md',
            selectable: true,
            items: [
                { label: 'Home', icon: '🏠' },
                { label: 'Profile', icon: '👤' },
                { label: 'Settings', icon: '⚙️' },
                { label: 'Help', icon: '❓' },
                { label: 'Logout', icon: '🚪' }
            ]
        },
        horizontal: {
            orientation: 'horizontal',
            variant: 'primary',
            size: 'md',
            showIcons: true,
            items: [
                { label: 'File', icon: '📁' },
                { label: 'Edit', icon: '✏️' },
                { label: 'View', icon: '👁️' },
                { label: 'Tools', icon: '🛠️' },
                { label: 'Help', icon: '❓' }
            ]
        },
        selectable: {
            orientation: 'vertical',
            variant: 'secondary',
            size: 'lg',
            selectable: true,
            multiSelect: true,
            showBadges: true,
            items: [
                { label: 'Documents', icon: '📁', badge: '12' },
                { label: 'Pictures', icon: '🖼️', badge: '8' },
                { label: 'Videos', icon: '🎬', badge: '3' },
                { label: 'Music', icon: '🎵', badge: '247' },
                { label: 'Downloads', icon: '⬇️', badge: '5' }
            ]
        },
        navigation: {
            orientation: 'horizontal',
            variant: 'primary',
            size: 'md',
            showIcons: true,
            bordered: true,
            items: [
                { label: 'Dashboard', icon: '📊' },
                { label: 'Projects', icon: '📁', badge: '3' },
                { label: 'Team', icon: '👥', badge: '12' },
                { label: 'Reports', icon: '📈' },
                { label: 'Analytics', icon: '📊' }
            ]
        }
    };
    
    const config = menuConfigs[type] || menuConfigs.default;
    
    // Create menu as a simple DOM element for demo
    const menuElement = document.createElement('div');
    menuElement.className = 'plauna-demo-menu';
    menuElement.style.cssText = (
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
    
    // Create menu container
    const menuContainer = document.createElement('div');
    menuContainer.style.cssText = (
        'display: ' + (config.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
        'flex-direction: ' + (config.orientation === 'horizontal' ? 'row' : 'column') + ';' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'width: 100%;'
    );
    
    // Create menu items
    config.items.forEach((item, index) => {
        const menuItem = document.createElement('div');
        menuItem.dataset.menuItem = index.toString();
        menuItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'cursor: ' + (config.selectable ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'background: transparent;' +
            'color: ' + getMenuTextColor(config.variant) + ';' +
            'border: ' + (config.bordered ? '1px solid ' + getMenuBorderColor(config.variant) : 'none') + ';'
        );
        
        // Add hover effect
        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = getMenuHoverBackgroundColor(config.variant);
        });
        
        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'transparent';
        });
        
        // Add icon if enabled
        if (config.showIcons && item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 16px;' +
                'color: ' + getMenuTextColor(config.variant) + ';' +
                'flex-shrink: 0;'
            );
            menuItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = (
            'flex: 1;' +
            'color: inherit;' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';'
        );
        menuItem.appendChild(label);
        
        // Add badge if enabled
        if (config.showBadges && item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: ' + getMenuBadgeColor(config.variant) + ';' +
                'color: white;' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-left: ' + tokens.get('spacing.sm') + ';' +
                'flex-shrink: 0;'
            );
            menuItem.appendChild(badge);
        }
        
        // Add click handler for selectable menus
        if (config.selectable) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                const isSelected = menuItem.style.background !== 'transparent';
                
                // Clear all selections for single-select mode
                if (!config.multiSelect) {
                    menuContainer.querySelectorAll('[data-menu-item]').forEach(item => {
                    item.style.background = 'transparent';
                });
                }
                
                // Toggle selection
                if (isSelected) {
                    menuItem.style.background = 'transparent';
                } else {
                    menuItem.style.background = getMenuSelectedBackgroundColor(config.variant);
                }
                
                toastManager.show(`Selected: ${item.label}`, 'info');
            });
        }
        
        menuContainer.appendChild(menuItem);
    });
    
    menuElement.appendChild(menuContainer);
    
    // Helper functions for menu colors
    function getMenuTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: 'rgba(59, 130, 246, 0.3)',
            secondary: 'rgba(107, 114, 128, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuHoverBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            primary: 'rgba(59, 130, 246, 0.1)',
            secondary: 'rgba(107, 114, 128, 0.1)',
            success: 'rgba(34, 197, 94, 0.1)',
            warning: 'rgba(245, 158, 11, 0.1)',
            error: 'rgba(239, 68, 68, 0.1)',
            info: 'rgba(59, 130, 246, 0.1)'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuSelectedBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: 'rgba(59, 130, 246, 0.2)',
            secondary: 'rgba(107, 114, 128, 0.2)',
            success: 'rgba(34, 197, 94, 0.2)',
            warning: 'rgba(245, 158, 11, 0.2)',
            error: 'rgba(239, 68, 68, 0.2)',
            info: 'rgba(59, 130, 246, 0.2)'
        };
        return colors[variant] || colors.default;
    }
    
    function getMenuBadgeColor(variant) {
        const colors = {
            default: '#94a3b8',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(menuElement);
    
    // Animate in
    requestAnimationFrame(() => {
        menuElement.style.opacity = '1';
        menuElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!menuElement.contains(e.target)) {
                closeMenu();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeMenu();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeMenu() {
        menuElement.style.opacity = '0';
        menuElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (menuElement.parentNode) {
                menuElement.parentNode.removeChild(menuElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.orientation} menu displayed`, 'info');
}

export function createDemoNavbar(type, triggerButton, toastManager) {
    // Define tokens for demo use (since we're not importing the full Plauna system)
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const navbarConfigs = {
        default: {
            variant: 'default',
            position: 'top',
            brand: 'MyApp',
            items: [
                { label: 'Home', active: true },
                { label: 'Products' },
                { label: 'About' },
                { label: 'Contact' }
            ],
            actions: [
                { label: 'Login', variant: 'solid' }
            ]
        },
        primary: {
            variant: 'primary',
            position: 'fixed-top',
            brand: { text: 'Company', logo: { src: 'https://picsum.photos/seed/company/32/32', alt: 'Company' } },
            items: [
                { label: 'Dashboard', active: true },
                { label: 'Analytics' },
                { label: 'Reports' }
            ],
            actions: [
                { label: 'Profile', icon: '👤' },
                { label: 'Settings', icon: '⚙️' }
            ]
        },
        sticky: {
            variant: 'secondary',
            position: 'fixed-top',
            sticky: true,
            brand: 'StickyNav',
            items: [
                { label: 'Home', active: true },
                { label: 'Docs' },
                { label: 'Examples' },
                { label: 'Pricing' }
            ],
            actions: [
                { label: 'Get Started', variant: 'solid' }
            ]
        },
        transparent: {
            variant: 'default',
            position: 'fixed-top',
            transparent: true,
            brand: 'Transparent',
            items: [
                { label: 'Home', active: true },
                { label: 'Features' },
                { label: 'Pricing' }
            ],
            actions: [
                { label: 'Sign Up', variant: 'solid' }
            ]
        }
    };
    
    const config = navbarConfigs[type] || navbarConfigs.default;
    
    // Create navbar as a simple DOM element for demo
    const navbarElement = document.createElement('div');
    navbarElement.className = 'plauna-demo-navbar';
    navbarElement.style.cssText = (
        'position: fixed;' +
        'top: ' + (config.position === 'fixed-top' ? '0' : '20px') + ';' +
        'left: 0;' +
        'right: 0;' +
        'width: 100%;' +
        'background: ' + (config.transparent ? 'rgba(15, 23, 42, 0.95)' : getNavbarBackgroundColor(config.variant)) + ';' +
        'color: ' + getNavbarTextColor(config.variant) + ';' +
        'border-bottom: ' + (config.position === 'top' ? '1px solid ' + getNavbarBorderColor(config.variant) : 'none') + ';' +
        'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
        'z-index: 1000;' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: space-between;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'backdrop-filter: blur(4px);' +
        'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);' +
        'opacity: 0;' +
        'transform: translateY(-20px);' +
        'transition: all 300ms ease;'
    );
    
    // Create brand section
    const brandSection = document.createElement('div');
    brandSection.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'font-size: ' + tokens.get('fontSizes.lg') + ';' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: inherit;' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    // Add brand logo if present
    if (config.brand && config.brand.logo) {
        const logo = document.createElement('img');
        logo.src = config.brand.logo.src;
        logo.alt = config.brand.logo.alt || config.brand.text;
        logo.style.cssText = (
            'height: 32px;' +
            'width: auto;' +
            'object-fit: contain;' +
            'margin-right: ' + tokens.get('spacing.sm') + ';'
        );
        brandSection.appendChild(logo);
    }
    
    // Add brand text
    if (config.brand && (config.brand.text || typeof config.brand === 'string')) {
        const brandText = document.createElement('span');
        brandText.textContent = typeof config.brand === 'string' ? config.brand : config.brand.text;
        brandText.style.cssText = (
            'color: inherit;' +
            'font-weight: inherit;' +
            'font-size: inherit;'
        );
        brandSection.appendChild(brandText);
    }
    
    navbarElement.appendChild(brandSection);
    
    // Create nav items
    const navItems = document.createElement('div');
    navItems.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'flex: 1;' +
        'justify-content: center;'
    );
    
    config.items.forEach((item, index) => {
        const navItem = document.createElement('a');
        navItem.href = '#';
        navItem.textContent = item.label;
        navItem.style.cssText = (
            'color: ' + (item.active ? getNavbarTextColor(config.variant) : 'rgba(255, 255, 255, 0.7)') + ';' +
            'text-decoration: none;' +
            'font-weight: ' + (item.active ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'cursor: pointer;'
        );
        
        // Add active indicator
        if (item.active) {
            const indicator = document.createElement('div');
            indicator.style.cssText = (
                'position: absolute;' +
                'bottom: -2px;' +
                'left: 0;' +
                'right: 0;' +
                'height: 2px;' +
                'background: ' + getNavbarTextColor(config.variant) + ';' +
                'border-radius: 1px;'
            );
            navItem.appendChild(indicator);
        }
        
        navItem.addEventListener('mouseenter', () => {
            if (!item.active) {
                navItem.style.color = getNavbarTextColor(config.variant);
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
            }
        });
        
        navItem.addEventListener('mouseleave', () => {
            if (!item.active) {
                navItem.style.color = 'rgba(255, 255, 255, 0.7)';
                navItem.style.background = 'transparent';
            }
        });
        
        navItem.addEventListener('click', (e) => {
            e.preventDefault();
            toastManager.show(`Clicked: ${item.label}`, 'info');
        });
        
        navItems.appendChild(navItem);
    });
    
    navbarElement.appendChild(navItems);
    
    // Create actions section
    const actionsSection = document.createElement('div');
    actionsSection.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';'
    );
    
    config.actions.forEach((action, index) => {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.textContent = action.label;
        actionButton.style.cssText = (
            'background: ' + (action.variant === 'solid' ? getNavbarTextColor(config.variant) : 'transparent') + ';' +
            'color: ' + (action.variant === 'solid' ? getNavbarBackgroundColor(config.variant) : getNavbarTextColor(config.variant)) + ';' +
            'border: 1px solid ' + (action.variant === 'solid' ? getNavbarTextColor(config.variant) : getNavbarTextColor(config.variant)) + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        // Add icon if present
        if (action.icon) {
            const icon = document.createElement('span');
            icon.textContent = action.icon;
            icon.style.cssText = (
                'font-size: 16px;' +
                'color: inherit;' +
                'margin-right: ' + tokens.get('spacing.xs') + ';'
            );
            actionButton.insertBefore(icon, actionButton.firstChild);
        }
        
        actionButton.addEventListener('mouseenter', () => {
            if (action.variant === 'solid') {
                actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                actionButton.style.color = getNavbarTextColor(config.variant);
            } else {
                actionButton.style.background = getNavbarTextColor(config.variant);
                actionButton.style.color = getNavbarBackgroundColor(config.variant);
            }
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.background = action.variant === 'solid' ? getNavbarTextColor(config.variant) : 'transparent';
            actionButton.style.color = action.variant === 'solid' ? getNavbarBackgroundColor(config.variant) : getNavbarTextColor(config.variant);
        });
        
        actionButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toastManager.show(`Clicked: ${action.label}`, 'info');
        });
        
        actionsSection.appendChild(actionButton);
    });
    
    navbarElement.appendChild(actionsSection);
    
    // Helper functions for navbar colors
    function getNavbarBackgroundColor(variant) {
        const colors = {
            default: 'rgba(15, 23, 42, 0.95)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getNavbarTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: 'white',
            secondary: 'white',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getNavbarBorderColor(variant) {
        const colors = {
            default: 'rgba(99, 116, 141, 0.3)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(navbarElement);
    
    // Animate in
    requestAnimationFrame(() => {
        navbarElement.style.opacity = '1';
        navbarElement.style.transform = 'translateY(0)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!navbarElement.contains(e.target)) {
                closeNavbar();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeNavbar();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeNavbar() {
        navbarElement.style.opacity = '0';
        navbarElement.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            if (navbarElement.parentNode) {
                navbarElement.parentNode.removeChild(navbarElement);
            }
        }, 300);
    }
    
    toastManager.show(`${config.position} navbar displayed`, 'info');
}

export function createDemoSidebar(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const sidebarConfigs = {
        default: {
            variant: 'default',
            position: 'left',
            brand: { text: 'Sidebar', icon: '📁' },
            items: [
                { label: 'Dashboard', icon: '📊', active: true },
                { label: 'Documents', icon: '📄', badge: '12' },
                { label: 'Analytics', icon: '📈' },
                { label: 'Reports', icon: '📑' },
                { label: 'Settings', icon: '⚙️' },
                { label: 'Help', icon: '❓' }
            ],
            footer: '© 2024 MyApp'
        },
        primary: {
            variant: 'primary',
            position: 'left',
            brand: { text: 'Nav', icon: '🧭' },
            items: [
                { label: 'Home', icon: '🏠', active: true },
                { label: 'Profile', icon: '👤' },
                { label: 'Messages', icon: '💬', badge: '5' },
                { label: 'Notifications', icon: '🔔', badge: '3' }
            ]
        },
        collapsible: {
            variant: 'secondary',
            position: 'left',
            collapsible: true,
            brand: { text: 'Collapsible' },
            items: [
                { label: 'Menu 1', icon: '📋' },
                { label: 'Menu 2', icon: '📝' },
                { label: 'Menu 3', icon: '📊' },
                { label: 'Menu 4', icon: '📈' },
                { label: 'Menu 5', icon: '📑' }
            ]
        },
        right: {
            variant: 'info',
            position: 'right',
            brand: { text: 'Right Side' },
            items: [
                { label: 'Activity', icon: '🔔', active: true },
                { label: 'History', icon: '📚' },
                { label: 'Archive', icon: '📦' },
                { label: 'Trash', icon: '🗑️' }
            ],
            footer: {
                items: [
                    { label: 'Settings', icon: '⚙️', onClick: () => toastManager.show('Settings clicked', 'info') },
                    { label: 'Logout', icon: '🚪', onClick: () => toastManager.show('Logout clicked', 'info') }
                ]
            }
        }
    };
    
    const config = sidebarConfigs[type] || sidebarConfigs.default;
    
    // Create sidebar as a simple DOM element for demo
    const sidebarElement = document.createElement('div');
    sidebarElement.className = 'plauna-demo-sidebar';
    sidebarElement.style.cssText = (
        'position: fixed;' +
        'top: 0;' +
        (config.position === 'left' ? 'left: 0;' : 'right: 0;') +
        'width: 280px;' +
        'height: 100vh;' +
        'background: ' + getSidebarBackgroundColor(config.variant) + ';' +
        'color: ' + getSidebarTextColor(config.variant) + ';' +
        'border-' + (config.position === 'left' ? 'right' : 'left') + ': 1px solid ' + getSidebarBorderColor(config.variant) + ';' +
        'padding: ' + tokens.get('spacing.lg') + ' ' + tokens.get('spacing.xl') + ';' +
        'z-index: 1000;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'backdrop-filter: blur(4px);' +
        'box-shadow: 4px 0 12px rgba(0, 0, 0, 0.15);' +
        'opacity: 0;' +
        'transform: ' + (config.position === 'left' ? 'translateX(-100%)' : 'translateX(100%)') + ';' +
        'transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);'
    );
    
    // Create brand section
    const brandSection = document.createElement('div');
    brandSection.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: ' + tokens.get('spacing.sm') + ';' +
        'padding: ' + tokens.get('spacing.md') + ';' +
        'border-bottom: 1px solid ' + getSidebarBorderColor(config.variant) + ';' +
        'font-size: ' + tokens.get('fontSizes.lg') + ';' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: inherit;' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    // Add brand icon if present
    if (config.brand && config.brand.icon) {
        const icon = document.createElement('span');
        icon.textContent = config.brand.icon;
        icon.style.cssText = (
            'font-size: 24px;' +
            'color: inherit;'
        );
        brandSection.appendChild(icon);
    }
    
    // Add brand text
    if (config.brand && config.brand.text) {
        const brandText = document.createElement('span');
        brandText.textContent = config.brand.text;
        brandText.style.cssText = (
            'color: inherit;' +
            'font-weight: inherit;' +
            'font-size: inherit;'
        );
        brandSection.appendChild(brandText);
    }
    
    sidebarElement.appendChild(brandSection);
    
    // Create nav items
    const navItems = document.createElement('div');
    navItems.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: ' + tokens.get('spacing.xs') + ';' +
        'flex: 1;' +
        'overflow-y: auto;' +
        'overflow-x: hidden;'
    );
    
    config.items.forEach((item, index) => {
        const navItem = document.createElement('div');
        navItem.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.md') + ' ' + tokens.get('spacing.lg') + ';' +
            'color: ' + (item.active ? getSidebarTextColor(config.variant) : 'rgba(255, 255, 255, 0.7)') + ';' +
            'font-weight: ' + (item.active ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'text-decoration: none;'
        );
        
        // Add active indicator
        if (item.active) {
            const indicator = document.createElement('div');
            indicator.style.cssText = (
                'position: absolute;' +
                (config.position === 'left' ? 'left: 0;' : 'right: 0;') +
                'top: 0;' +
                'bottom: 0;' +
                'width: 3px;' +
                'background: ' + getSidebarTextColor(config.variant) + ';'
            );
            navItem.appendChild(indicator);
        }
        
        // Add icon
        if (item.icon) {
            const icon = document.createElement('span');
            icon.textContent = item.icon;
            icon.style.cssText = (
                'font-size: 18px;' +
                'color: inherit;' +
                'width: 20px;' +
                'text-align: center;'
            );
            navItem.appendChild(icon);
        }
        
        // Add label
        const label = document.createElement('span');
        label.textContent = item.label;
        label.style.cssText = (
            'color: inherit;' +
            'font-weight: inherit;' +
            'font-size: inherit;' +
            'flex: 1;'
        );
        navItem.appendChild(label);
        
        // Add badge if present
        if (item.badge) {
            const badge = document.createElement('span');
            badge.textContent = item.badge;
            badge.style.cssText = (
                'background: ' + (item.active ? getSidebarTextColor(config.variant) : 'rgba(255, 255, 255, 0.7)') + ';' +
                'color: ' + (item.active ? getSidebarBackgroundColor(config.variant) : 'white') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'padding: 2px 6px;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'margin-left: auto;' +
                'flex-shrink: 0;'
            );
            navItem.appendChild(badge);
        }
        
        navItem.addEventListener('mouseenter', () => {
            if (!item.active) {
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                navItem.style.color = getSidebarTextColor(config.variant);
            }
        });
        
        navItem.addEventListener('mouseleave', () => {
            if (!item.active) {
                navItem.style.background = 'transparent';
                navItem.style.color = 'rgba(255, 255, 255, 0.7)';
            }
        });
        
        navItem.addEventListener('click', () => {
            toastManager.show(`Clicked: ${item.label}`, 'info');
        });
        
        navItems.appendChild(navItem);
    });
    
    sidebarElement.appendChild(navItems);
    
    // Create footer section if present
    if (config.footer) {
        const footerSection = document.createElement('div');
        footerSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'padding: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + getSidebarBorderColor(config.variant) + ';' +
            'margin-top: auto;' +
            'flex-shrink: 0;'
        );
        
        if (typeof config.footer === 'string') {
            const footerText = document.createElement('div');
            footerText.textContent = config.footer;
            footerText.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'color: rgba(255, 255, 255, 0.7);' +
                'text-align: center;' +
                'opacity: 0.7;'
            );
            footerSection.appendChild(footerText);
        } else if (config.footer && config.footer.items) {
            config.footer.items.forEach(item => {
                const footerItem = document.createElement('div');
                footerItem.style.cssText = (
                    'display: flex;' +
                    'align-items: center;' +
                    'gap: ' + tokens.get('spacing.sm') + ';' +
                    'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
                    'color: rgba(255, 255, 255, 0.7);' +
                    'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                    'cursor: pointer;' +
                    'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                    'transition: all 150ms ease;'
                );
                
                if (item.icon) {
                    const icon = document.createElement('span');
                    icon.textContent = item.icon;
                    icon.style.cssText = (
                        'font-size: 16px;' +
                        'color: inherit;'
                    );
                    footerItem.appendChild(icon);
                }
                
                const label = document.createElement('span');
                label.textContent = item.label;
                label.style.cssText = (
                    'color: inherit;' +
                    'font-size: inherit;'
                );
                footerItem.appendChild(label);
                
                if (item.onClick) {
                    footerItem.addEventListener('click', item.onClick);
                }
                
                footerItem.addEventListener('mouseenter', () => {
                    footerItem.style.background = 'rgba(255, 255, 255, 0.1)';
                });
                
                footerItem.addEventListener('mouseleave', () => {
                    footerItem.style.background = 'transparent';
                });
                
                footerSection.appendChild(footerItem);
            });
        }
        
        sidebarElement.appendChild(footerSection);
    }
    
    // Add collapse toggle if collapsible
    if (config.collapsible) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.innerHTML = config.position === 'left' ? '◀' : '▶';
        toggle.style.cssText = (
            'position: absolute;' +
            (config.position === 'left' ? 'right: ' + tokens.get('spacing.md') + ';' : 'left: ' + tokens.get('spacing.md') + ';') +
            'top: ' + tokens.get('spacing.md') + ';' +
            'background: transparent;' +
            'border: none;' +
            'color: ' + getSidebarTextColor(config.variant) + ';' +
            'font-size: 18px;' +
            'cursor: pointer;' +
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'transition: all 150ms ease;' +
            'z-index: 10;'
        );
        
        toggle.addEventListener('click', () => {
            const isCollapsed = sidebarElement.style.width === '60px';
            if (isCollapsed) {
                sidebarElement.style.width = '280px';
                toggle.innerHTML = config.position === 'left' ? '◀' : '▶';
            } else {
                sidebarElement.style.width = '60px';
                toggle.innerHTML = config.position === 'left' ? '▶' : '◀';
            }
        });
        
        sidebarElement.appendChild(toggle);
    }
    
    // Helper functions for sidebar colors
    function getSidebarBackgroundColor(variant) {
        const colors = {
            default: 'rgba(15, 23, 42, 0.95)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getSidebarTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: 'white',
            secondary: 'white',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getSidebarBorderColor(variant) {
        const colors = {
            default: 'rgba(99, 116, 141, 0.3)',
            primary: 'rgba(59, 130, 246, 0.3)',
            secondary: 'rgba(107, 114, 128, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(sidebarElement);
    
    // Animate in
    requestAnimationFrame(() => {
        sidebarElement.style.opacity = '1';
        sidebarElement.style.transform = 'translateX(0)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!sidebarElement.contains(e.target)) {
                closeSidebar();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSidebar();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSidebar() {
        sidebarElement.style.opacity = '0';
        sidebarElement.style.transform = 'translateX(' + (config.position === 'left' ? '-100%)' : '100%') + ')';
        setTimeout(() => {
            if (sidebarElement.parentNode) {
                sidebarElement.parentNode.removeChild(sidebarElement);
            }
        }, 300);
    }
    
    toastManager.show(`${config.position} sidebar displayed`, 'info');
}

export function createDemoStepper(type, triggerButton, toastManager) {
    // Define tokens for demo use
    const tokens = {
        get: (path) => {
            const paths = path.split('.');
            const values = {
                'spacing.sm': '8px',
                'spacing.md': '16px',
                'spacing.lg': '24px',
                'spacing.xl': '32px',
                'spacing.xxxl': '48px',
                'borderRadius.sm': '4px',
                'borderRadius.md': '8px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const stepperConfigs = {
        default: {
            variant: 'default',
            orientation: 'horizontal',
            currentStep: 1,
            clickable: true,
            linear: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            steps: [
                { label: 'Account' },
                { label: 'Profile' },
                { label: 'Preferences' },
                { label: 'Review' }
            ]
        },
        vertical: {
            variant: 'primary',
            orientation: 'vertical',
            currentStep: 2,
            clickable: true,
            linear: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: true,
            steps: [
                { label: 'Personal Info', description: 'Basic information' },
                { label: 'Address', description: 'Shipping details' },
                { label: 'Payment', description: 'Payment method' },
                { label: 'Review', description: 'Review order' },
                { label: 'Complete', description: 'Finish setup' }
            ]
        },
        wizard: {
            variant: 'info',
            orientation: 'horizontal',
            currentStep: 0,
            clickable: true,
            linear: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            steps: [
                { label: 'Welcome' },
                { label: 'Setup' },
                { label: 'Configure' },
                { label: 'Launch' }
            ]
        },
        process: {
            variant: 'success',
            orientation: 'vertical',
            currentStep: 3,
            clickable: false,
            linear: true,
            showNumbers: false,
            showLabels: true,
            showDescriptions: true,
            steps: [
                { label: 'Data Collection', description: 'Gathering requirements' },
                { label: 'Analysis', description: 'Processing data' },
                { label: 'Design', description: 'Creating solution' },
                { label: 'Implementation', description: 'Building product' },
                { label: 'Testing', description: 'Quality assurance' },
                { label: 'Deployment', description: 'Going live' }
            ]
        },
        error: {
            variant: 'error',
            orientation: 'horizontal',
            currentStep: 2,
            clickable: true,
            linear: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            steps: [
                { label: 'Start' },
                { label: 'Process' },
                { label: 'Error' },
                { label: 'Retry' }
            ]
        }
    };
    
    const config = stepperConfigs[type] || stepperConfigs.default;
    
    // Create stepper as a simple DOM element for demo
    const stepperElement = document.createElement('div');
    stepperElement.className = 'plauna-demo-stepper';
    stepperElement.style.cssText = (
        'position: fixed;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'background: rgba(15, 23, 42, 0.95);' +
        'border: 1px solid rgba(99, 116, 141, 0.3);' +
        'border-radius: 12px;' +
        'box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);' +
        'padding: 32px;' +
        'z-index: 1000;' +
        'opacity: 0;' +
        'transform: translate(-50%, -50%) scale(0.9);' +
        'transition: all 200ms ease;' +
        'backdrop-filter: blur(4px);' +
        'min-width: 600px;' +
        'max-width: 800px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Step Progress Indicator';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    stepperElement.appendChild(title);
    
    // Create stepper container
    const stepperContainer = document.createElement('div');
    stepperContainer.style.cssText = (
        'display: ' + (config.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
        'flex-direction: ' + (config.orientation === 'horizontal' ? 'row' : 'column') + ';' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'width: 100%;' +
        'position: relative;' +
        'padding: ' + tokens.get('spacing.lg') + ';'
    );
    
    // Create steps
    config.steps.forEach((step, index) => {
        const state = index < config.currentStep ? 'completed' : 
                     index === config.currentStep ? 'active' : 'pending';
        
        const stepElement = document.createElement('div');
        stepElement.dataset.stepIndex = index.toString();
        stepElement.style.cssText = (
            'display: flex;' +
            'flex-direction: ' + (config.orientation === 'horizontal' ? 'column' : 'row') + ';' +
            'align-items: ' + (config.orientation === 'horizontal' ? 'center' : 'flex-start') + ';' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'cursor: ' + (config.clickable && (!config.linear || index <= config.currentStep) ? 'pointer' : 'default') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex: 1;'
        );
        
        // Create step indicator
        const indicator = document.createElement('div');
        indicator.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 32px;' +
            'height: 32px;' +
            'border-radius: 50%;' +
            'border: 2px solid ' + getStepperBorderColor(state, config.variant) + ';' +
            'background: ' + getStepperBackgroundColor(state, config.variant) + ';' +
            'color: ' + getStepperTextColor(state, config.variant) + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex-shrink: 0;'
        );
        
        // Add step number or icon
        if (config.showNumbers) {
            const number = document.createElement('span');
            number.textContent = state === 'completed' ? '✓' : index + 1;
            indicator.appendChild(number);
        }
        
        stepElement.appendChild(indicator);
        
        // Create step content
        if (config.showLabels || config.showDescriptions) {
            const content = document.createElement('div');
            content.style.cssText = (
                'display: flex;' +
                'flex-direction: column;' +
                'gap: ' + tokens.get('spacing.xs') + ';' +
                'text-align: ' + (config.orientation === 'horizontal' ? 'center' : 'left') + ';'
            );
            
            // Add label
            if (config.showLabels && step.label) {
                const label = document.createElement('div');
                label.textContent = step.label;
                label.style.cssText = (
                    'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                    'font-weight: ' + (state === 'active' ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
                    'color: ' + getStepperTextColor(state, config.variant) + ';' +
                    'line-height: 1.2;'
                );
                content.appendChild(label);
            }
            
            // Add description
            if (config.showDescriptions && step.description) {
                const description = document.createElement('div');
                description.textContent = step.description;
                description.style.cssText = (
                    'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                    'color: #94a3b8;' +
                    'line-height: 1.3;' +
                    'opacity: 0.8;'
                );
                content.appendChild(description);
            }
            
            stepElement.appendChild(content);
        }
        
        // Add click handler
        if (config.clickable && (!config.linear || index <= config.currentStep)) {
            stepElement.addEventListener('click', (e) => {
                e.stopPropagation();
                updateStepperStep(index);
                toastManager.show(`Navigated to step ${index + 1}: ${step.label}`, 'info');
            });
            
            stepElement.addEventListener('mouseenter', () => {
                if (state !== 'active') {
                    stepElement.style.opacity = '0.8';
                }
            });
            
            stepElement.addEventListener('mouseleave', () => {
                if (state !== 'active') {
                    stepElement.style.opacity = '1';
                }
            });
        }
        
        stepperContainer.appendChild(stepElement);
        
        // Add connector (except for last step)
        if (index < config.steps.length - 1) {
            const connector = document.createElement('div');
            const isCompleted = state === 'completed';
            
            connector.style.cssText = (
                'position: absolute;' +
                (config.orientation === 'horizontal' ? 
                    'left: 32px;' +
                    'right: -16px;' +
                    'top: 16px;' +
                    'height: 2px;' :
                    'top: 32px;' +
                    'bottom: -16px;' +
                    'left: 16px;' +
                    'width: 2px;'
                ) +
                'background: ' + (isCompleted ? getStepperTextColor('completed', config.variant) : '#475569') + ';' +
                'transition: all 150ms ease;'
            );
            
            stepperContainer.appendChild(connector);
        }
    });
    
    stepperElement.appendChild(stepperContainer);
    
    // Create navigation controls
    let controls = null;
    if (config.clickable) {
        controls = document.createElement('div');
        controls.style.cssText = (
            'display: flex;' +
            'justify-content: center;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding-top: ' + tokens.get('spacing.lg') + ';' +
            'border-top: 1px solid rgba(99, 116, 141, 0.3);'
        );
        
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Previous';
        prevButton.style.cssText = (
            'background: transparent;' +
            'color: #94a3b8;' +
            'border: 1px solid #475569;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        prevButton.addEventListener('click', () => {
            if (config.currentStep > 0) {
                updateStepperStep(config.currentStep - 1);
                toastManager.show('Previous step', 'info');
            }
        });
        
        prevButton.addEventListener('mouseenter', () => {
            prevButton.style.background = 'rgba(255, 255, 255, 0.1)';
            prevButton.style.color = '#e4e4e7';
        });
        
        prevButton.addEventListener('mouseleave', () => {
            prevButton.style.background = 'transparent';
            prevButton.style.color = '#94a3b8';
        });
        
        const nextButton = document.createElement('button');
        nextButton.textContent = 'Next';
        nextButton.style.cssText = (
            'background: ' + getStepperTextColor('active', config.variant) + ';' +
            'color: ' + getStepperBackgroundColor('active', config.variant) + ';' +
            'border: 1px solid ' + getStepperTextColor('active', config.variant) + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        nextButton.addEventListener('click', () => {
            if (config.currentStep < config.steps.length - 1) {
                updateStepperStep(config.currentStep + 1);
                toastManager.show('Next step', 'info');
            } else {
                toastManager.show('Last step reached', 'info');
            }
        });
        
        nextButton.addEventListener('mouseenter', () => {
            nextButton.style.background = 'rgba(255, 255, 255, 0.1)';
            nextButton.style.color = getStepperTextColor('active', config.variant);
        });
        
        nextButton.addEventListener('mouseleave', () => {
            nextButton.style.background = getStepperTextColor('active', config.variant);
            nextButton.style.color = getStepperBackgroundColor('active', config.variant);
        });
        
        controls.appendChild(prevButton);
        controls.appendChild(nextButton);
        stepperElement.appendChild(controls);
    }
    
    // Helper functions for stepper colors
    function getStepperTextColor(state, variant) {
        const colors = {
            default: {
                pending: '#94a3b8',
                active: '#e4e4e7',
                completed: '#e4e4e7',
                error: '#ef4444'
            },
            primary: {
                pending: '#94a3b8',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            },
            secondary: {
                pending: '#94a3b8',
                active: '#6b7280',
                completed: '#6b7280',
                error: '#ef4444'
            },
            success: {
                pending: '#94a3b8',
                active: '#22c55e',
                completed: '#22c55e',
                error: '#ef4444'
            },
            warning: {
                pending: '#94a3b8',
                active: '#f59e0b',
                completed: '#f59e0b',
                error: '#ef4444'
            },
            error: {
                pending: '#94a3b8',
                active: '#ef4444',
                completed: '#ef4444',
                error: '#ef4444'
            },
            info: {
                pending: '#94a3b8',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            }
        };
        return colors[variant]?.[state] || colors.default[state];
    }
    
    function getStepperBackgroundColor(state, variant) {
        const colors = {
            default: {
                pending: 'transparent',
                active: 'rgba(15, 23, 42, 0.95)',
                completed: 'rgba(15, 23, 42, 0.95)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            primary: {
                pending: 'transparent',
                active: 'rgba(59, 130, 246, 0.1)',
                completed: 'rgba(59, 130, 246, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            secondary: {
                pending: 'transparent',
                active: 'rgba(107, 114, 128, 0.1)',
                completed: 'rgba(107, 114, 128, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            success: {
                pending: 'transparent',
                active: 'rgba(34, 197, 94, 0.1)',
                completed: 'rgba(34, 197, 94, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            warning: {
                pending: 'transparent',
                active: 'rgba(245, 158, 11, 0.1)',
                completed: 'rgba(245, 158, 11, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            error: {
                pending: 'transparent',
                active: 'rgba(239, 68, 68, 0.1)',
                completed: 'rgba(239, 68, 68, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            },
            info: {
                pending: 'transparent',
                active: 'rgba(59, 130, 246, 0.1)',
                completed: 'rgba(59, 130, 246, 0.1)',
                error: 'rgba(239, 68, 68, 0.1)'
            }
        };
        return colors[variant]?.[state] || colors.default[state];
    }
    
    function getStepperBorderColor(state, variant) {
        const colors = {
            default: {
                pending: '#475569',
                active: '#e4e4e7',
                completed: '#e4e4e7',
                error: '#ef4444'
            },
            primary: {
                pending: '#475569',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            },
            secondary: {
                pending: '#475569',
                active: '#6b7280',
                completed: '#6b7280',
                error: '#ef4444'
            },
            success: {
                pending: '#475569',
                active: '#22c55e',
                completed: '#22c55e',
                error: '#ef4444'
            },
            warning: {
                pending: '#475569',
                active: '#f59e0b',
                completed: '#f59e0b',
                error: '#ef4444'
            },
            error: {
                pending: '#475569',
                active: '#ef4444',
                completed: '#ef4444',
                error: '#ef4444'
            },
            info: {
                pending: '#475569',
                active: '#3b82f6',
                completed: '#3b82f6',
                error: '#ef4444'
            }
        };
        return colors[variant]?.[state] || colors.default[state];
    }
    
    // Update stepper step function
    function updateStepperStep(newStep) {
        config.currentStep = newStep;
        
        // Clear stepper element
        stepperElement.innerHTML = '';
        
        // Recreate title
        stepperElement.appendChild(title);
        
        // Recreate stepper container with updated step
        const newStepperContainer = document.createElement('div');
        newStepperContainer.style.cssText = (
            'display: ' + (config.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (config.orientation === 'horizontal' ? 'row' : 'column') + ';' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'width: 100%;' +
            'position: relative;' +
            'padding: ' + tokens.get('spacing.lg') + ';'
        );
        
        // Recreate steps with new current step
        config.steps.forEach((step, index) => {
            const state = index < config.currentStep ? 'completed' : 
                         index === config.currentStep ? 'active' : 'pending';
            
            const stepElement = document.createElement('div');
            stepElement.dataset.stepIndex = index.toString();
            stepElement.style.cssText = (
                'display: flex;' +
                'flex-direction: ' + (config.orientation === 'horizontal' ? 'column' : 'row') + ';' +
                'align-items: ' + (config.orientation === 'horizontal' ? 'center' : 'flex-start') + ';' +
                'gap: ' + tokens.get('spacing.sm') + ';' +
                'cursor: ' + (config.clickable && (!config.linear || index <= config.currentStep) ? 'pointer' : 'default') + ';' +
                'transition: all 150ms ease;' +
                'position: relative;' +
                'flex: 1;'
            );
            
            // Create step indicator
            const indicator = document.createElement('div');
            indicator.style.cssText = (
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'width: 32px;' +
                'height: 32px;' +
                'border-radius: 50%;' +
                'border: 2px solid ' + getStepperBorderColor(state, config.variant) + ';' +
                'background: ' + getStepperBackgroundColor(state, config.variant) + ';' +
                'color: ' + getStepperTextColor(state, config.variant) + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'transition: all 150ms ease;' +
                'position: relative;' +
                'flex-shrink: 0;'
            );
            
            // Add step number or icon
            if (config.showNumbers) {
                const number = document.createElement('span');
                number.textContent = state === 'completed' ? '✓' : index + 1;
                indicator.appendChild(number);
            }
            
            stepElement.appendChild(indicator);
            
            // Create step content
            if (config.showLabels || config.showDescriptions) {
                const content = document.createElement('div');
                content.style.cssText = (
                    'display: flex;' +
                    'flex-direction: column;' +
                    'gap: ' + tokens.get('spacing.xs') + ';' +
                    'text-align: ' + (config.orientation === 'horizontal' ? 'center' : 'left') + ';'
                );
                
                // Add label
                if (config.showLabels && step.label) {
                    const label = document.createElement('div');
                    label.textContent = step.label;
                    label.style.cssText = (
                        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                        'font-weight: ' + (state === 'active' ? tokens.get('fontWeights.semibold') : tokens.get('fontWeights.medium')) + ';' +
                        'color: ' + getStepperTextColor(state, config.variant) + ';' +
                        'line-height: 1.2;'
                    );
                    content.appendChild(label);
                }
                
                // Add description
                if (config.showDescriptions && step.description) {
                    const description = document.createElement('div');
                    description.textContent = step.description;
                    description.style.cssText = (
                        'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                        'color: #94a3b8;' +
                        'line-height: 1.3;' +
                        'opacity: 0.8;'
                    );
                    content.appendChild(description);
                }
                
                stepElement.appendChild(content);
            }
            
            // Add click handler
            if (config.clickable && (!config.linear || index <= config.currentStep)) {
                stepElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    updateStepperStep(index);
                    toastManager.show(`Navigated to step ${index + 1}: ${step.label}`, 'info');
                });
                
                stepElement.addEventListener('mouseenter', () => {
                    if (state !== 'active') {
                        stepElement.style.opacity = '0.8';
                    }
                });
                
                stepElement.addEventListener('mouseleave', () => {
                    if (state !== 'active') {
                        stepElement.style.opacity = '1';
                    }
                });
            }
            
            newStepperContainer.appendChild(stepElement);
            
            // Add connector (except for last step)
            if (index < config.steps.length - 1) {
                const connector = document.createElement('div');
                const isCompleted = state === 'completed';
                
                connector.style.cssText = (
                    'position: absolute;' +
                    (config.orientation === 'horizontal' ? 
                        'left: 32px;' +
                        'right: -16px;' +
                        'top: 16px;' +
                        'height: 2px;' :
                        'top: 32px;' +
                        'bottom: -16px;' +
                        'left: 16px;' +
                        'width: 2px;'
                    ) +
                    'background: ' + (isCompleted ? getStepperTextColor('completed', config.variant) : '#475569') + ';' +
                    'transition: all 150ms ease;'
                );
                
                newStepperContainer.appendChild(connector);
            }
        });
        
        stepperElement.appendChild(newStepperContainer);
        
        // Recreate controls
        if (controls) {
            stepperElement.appendChild(controls);
        }
    }
    
    // Add to DOM
    document.body.appendChild(stepperElement);
    
    // Animate in
    requestAnimationFrame(() => {
        stepperElement.style.opacity = '1';
        stepperElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!stepperElement.contains(e.target)) {
                closeStepper();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeStepper();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeStepper() {
        stepperElement.style.opacity = '0';
        stepperElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (stepperElement.parentNode) {
                stepperElement.parentNode.removeChild(stepperElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.orientation} stepper displayed`, 'info');
}
