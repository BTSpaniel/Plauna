// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab demos: chip, alert, toast, spinner, status, empty state.
 * Split out of lab/workbench-lab.js.
 */

import { widgetStyleManager } from '../../widgets/WidgetStyleManager.js';

export function createDemoChip(type, triggerButton, toastManager) {
    const chipConfigs = {
        default: {
            chips: [
                { label: 'React', variant: 'primary' },
                { label: 'JavaScript', variant: 'secondary' },
                { label: 'CSS', variant: 'success' },
                { label: 'HTML', variant: 'warning' },
                { label: 'TypeScript', variant: 'error' }
            ]
        },
        removable: {
            chips: [
                { label: 'Tag 1', removable: true },
                { label: 'Tag 2', removable: true },
                { label: 'Tag 3', removable: true },
                { label: 'Tag 4', removable: true }
            ]
        },
        avatar: {
            chips: [
                { label: 'John Doe', avatar: { src: 'https://picsum.photos/seed/john/24/24', alt: 'John' } },
                { label: 'Jane Smith', avatar: { src: 'https://picsum.photos/seed/jane/24/24', alt: 'Jane' } },
                { label: 'Bob Johnson', avatar: { src: 'https://picsum.photos/seed/bob/24/24', alt: 'Bob' } }
            ]
        }
    };
    
    const config = chipConfigs[type] || chipConfigs.default;
    
    // Create chip container using theme-based styling
    const chipStyles = widgetStyleManager.getWidgetStyles('chip');
    const chipElement = widgetStyleManager.createStyledElement('div', chipStyles.container, 'plauna-demo-chip');
    
    // Create chips container
    const chipsContainer = widgetStyleManager.createStyledElement('div', chipStyles.chipsContainer);
    
    // Create chips
    config.chips.forEach((chip, index) => {
        const chipItem = widgetStyleManager.createStyledElement('div', chipStyles.chip);
        
        // Add avatar if present
        if (chip.avatar) {
            const avatar = widgetStyleManager.createStyledElement('img', chipStyles.avatar);
            avatar.src = chip.avatar.src;
            avatar.alt = chip.avatar.alt;
            chipItem.appendChild(avatar);
        }
        
        // Add label
        const label = widgetStyleManager.createStyledElement('span', chipStyles.label);
        label.textContent = chip.label;
        chipItem.appendChild(label);
        
        // Add remove button if removable
        if (chip.removable) {
            const removeButton = widgetStyleManager.createStyledElement('button', chipStyles.removeButton);
            removeButton.textContent = '×';
            
            removeButton.addEventListener('mouseenter', () => {
                widgetStyleManager.applyStyles(removeButton, chipStyles.removeButtonHover);
            });
            
            removeButton.addEventListener('mouseleave', () => {
                widgetStyleManager.applyStyles(removeButton, { opacity: '0.7' });
            });
            
            removeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                widgetStyleManager.applyStyles(chipItem, { opacity: '0', transform: 'scale(0.8)' });
                setTimeout(() => {
                    chipItem.remove();
                    toastManager.show(`Removed: ${chip.label}`, 'info');
                }, 150);
            });
            
            chipItem.appendChild(removeButton);
        }
        
        // Add hover effect
        chipItem.addEventListener('mouseenter', () => {
            widgetStyleManager.applyStyles(chipItem, chipStyles.chipHover);
        });
        
        chipItem.addEventListener('mouseleave', () => {
            widgetStyleManager.applyStyles(chipItem, { transform: 'translateY(0)', boxShadow: 'none' });
        });
        
        // Add click handler
        chipItem.addEventListener('click', () => {
            toastManager.show(`Clicked: ${chip.label}`, 'info');
        });
        
        chipsContainer.appendChild(chipItem);
    });
    
    chipElement.appendChild(chipsContainer);
    
    // Helper functions for chip colors
    function getChipBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            primary: 'rgba(59, 130, 246, 0.1)',
            secondary: 'rgba(107, 114, 128, 0.1)',
            success: 'rgba(34, 197, 94, 0.1)',
            warning: 'rgba(245, 158, 11, 0.1)',
            error: 'rgba(239, 68, 68, 0.1)'
        };
        return colors[variant] || colors.default;
    }
    
    function getChipTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444'
        };
        return colors[variant] || colors.default;
    }
    
    function getChipBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            primary: 'rgba(59, 130, 246, 0.3)',
            secondary: 'rgba(107, 114, 128, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(chipElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(chipElement, chipStyles.visible);
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!chipElement.contains(e.target)) {
                closeChip();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeChip();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeChip() {
        widgetStyleManager.applyStyles(chipElement, chipStyles.hidden);
        setTimeout(() => {
            if (chipElement.parentNode) {
                chipElement.parentNode.removeChild(chipElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} chips displayed`, 'info');
}

export function createDemoAlert(type, triggerButton, toastManager) {
    const alertConfigs = {
        default: {
            title: 'Success!',
            message: 'Your changes have been saved successfully.',
            variant: 'success',
            dismissible: true
        },
        warning: {
            title: 'Warning',
            message: 'This action cannot be undone. Please proceed with caution.',
            variant: 'warning',
            dismissible: true
        },
        error: {
            title: 'Error',
            message: 'Something went wrong. Please try again later.',
            variant: 'error',
            dismissible: true
        },
        info: {
            title: 'Information',
            message: 'Here is some important information you should know.',
            variant: 'info',
            dismissible: true
        },
        action: {
            title: 'Action Required',
            message: 'Please review and accept the terms to continue.',
            variant: 'primary',
            dismissible: false,
            action: {
                label: 'Review Terms',
                onClick: () => {
                    toastManager.show('Review terms clicked', 'info');
                }
            }
        }
    };
    
    const config = alertConfigs[type] || alertConfigs.default;
    
    // Create alert using theme-based styling
    const alertStyles = widgetStyleManager.getWidgetStyles('alert');
    const alertElement = widgetStyleManager.createStyledElement('div', alertStyles.container, 'plauna-demo-alert');
    
    // Create alert content
    const alertContent = widgetStyleManager.createStyledElement('div', alertStyles.content);
    
    // Create title
    const title = widgetStyleManager.createStyledElement('div', alertStyles.title);
    title.textContent = config.title;
    alertContent.appendChild(title);
    
    // Create message
    const message = widgetStyleManager.createStyledElement('div', alertStyles.message);
    message.textContent = config.message;
    alertContent.appendChild(message);
    
    // Create action button if present
    if (config.action) {
        const actionButton = widgetStyleManager.createStyledElement('button', alertStyles.actionButton);
        actionButton.textContent = config.action.label;
        
        actionButton.addEventListener('click', () => {
            if (config.action.onClick) {
                config.action.onClick();
            }
        });
        
        alertContent.appendChild(actionButton);
    }
    
    // Create dismiss button if dismissible
    if (config.dismissible) {
        const dismissButton = widgetStyleManager.createStyledElement('button', alertStyles.dismissButton);
        dismissButton.textContent = '×';
        
        dismissButton.addEventListener('mouseenter', () => {
            widgetStyleManager.applyStyles(dismissButton, alertStyles.dismissButtonHover);
        });
        
        dismissButton.addEventListener('mouseleave', () => {
            widgetStyleManager.applyStyles(dismissButton, { opacity: '0.7' });
        });
        
        dismissButton.addEventListener('click', () => {
            closeAlert();
        });
        
        alertElement.appendChild(dismissButton);
    }
    
    alertElement.appendChild(alertContent);
    
    // Helper functions for alert colors
    function getAlertBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            success: 'rgba(34, 197, 94, 0.1)',
            warning: 'rgba(245, 158, 11, 0.1)',
            error: 'rgba(239, 68, 68, 0.1)',
            info: 'rgba(59, 130, 246, 0.1)',
            primary: 'rgba(59, 130, 246, 0.1)'
        };
        return colors[variant] || colors.default;
    }
    
    function getAlertTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6',
            primary: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getAlertBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)',
            primary: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(alertElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(alertElement, alertStyles.visible);
    });
    
    // Auto-dismiss after 5 seconds if dismissible
    if (config.dismissible) {
        setTimeout(() => {
            closeAlert();
        }, 5000);
    }
    
    function closeAlert() {
        widgetStyleManager.applyStyles(alertElement, alertStyles.hidden);
        setTimeout(() => {
            if (alertElement.parentNode) {
                alertElement.parentNode.removeChild(alertElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} alert displayed`, 'info');
}

export function createDemoToast(type, triggerButton, toastManager) {
    const toastConfigs = {
        default: {
            message: 'This is a toast notification',
            variant: 'default',
            position: 'top-right',
            duration: 3000
        },
        success: {
            message: 'Operation completed successfully!',
            variant: 'success',
            position: 'top-right',
            duration: 3000
        },
        error: {
            message: 'An error occurred',
            variant: 'error',
            position: 'top-right',
            duration: 5000
        },
        action: {
            message: 'New message received',
            variant: 'primary',
            position: 'bottom-right',
            duration: 0, // No auto-dismiss
            action: {
                label: 'View',
                onClick: () => {
                    toastManager.show('View message clicked', 'info');
                }
            }
        }
    };
    
    const config = toastConfigs[type] || toastConfigs.default;
    
    // Create toast using theme-based styling
    const toastStyles = widgetStyleManager.getWidgetStyles('toast');
    const toastElement = widgetStyleManager.createStyledElement('div', toastStyles.container, 'plauna-demo-toast');
    
    // Set position
    const positions = {
        'top-right': toastStyles.positions.topRight,
        'top-left': toastStyles.positions.topLeft,
        'bottom-right': toastStyles.positions.bottomRight,
        'bottom-left': toastStyles.positions.bottomLeft
    };
    const positionStyles = positions[config.position] || positions['top-right'];
    widgetStyleManager.applyStyles(toastElement, positionStyles);
    
    // Create icon
    const icon = widgetStyleManager.createStyledElement('span', toastStyles.icon);
    icon.textContent = getToastIcon(config.variant);
    toastElement.appendChild(icon);
    
    // Create message
    const message = widgetStyleManager.createStyledElement('span', toastStyles.message);
    message.textContent = config.message;
    toastElement.appendChild(message);
    
    // Create action button if present
    if (config.action) {
        const actionButton = widgetStyleManager.createStyledElement('button', toastStyles.actionButton);
        actionButton.textContent = config.action.label;
        
        actionButton.addEventListener('click', () => {
            if (config.action.onClick) {
                config.action.onClick();
            }
        });
        
        toastElement.appendChild(actionButton);
    }
    
    // Create dismiss button
    const dismissButton = widgetStyleManager.createStyledElement('button', toastStyles.dismissButton);
    dismissButton.textContent = '×';
    
    dismissButton.addEventListener('mouseenter', () => {
        widgetStyleManager.applyStyles(dismissButton, toastStyles.dismissButtonHover);
    });
    
    dismissButton.addEventListener('mouseleave', () => {
        widgetStyleManager.applyStyles(dismissButton, { opacity: '0.7' });
    });
    
    dismissButton.addEventListener('click', () => {
        closeToast();
    });
    
    toastElement.appendChild(dismissButton);
    
    // Helper functions for toast colors
    function getToastBackgroundColor(variant) {
        const colors = {
            default: 'rgba(15, 23, 42, 0.95)',
            success: 'rgba(34, 197, 94, 0.95)',
            warning: 'rgba(245, 158, 11, 0.95)',
            error: 'rgba(239, 68, 68, 0.95)',
            info: 'rgba(59, 130, 246, 0.95)',
            primary: 'rgba(59, 130, 246, 0.95)'
        };
        return colors[variant] || colors.default;
    }
    
    function getToastTextColor(variant) {
        const colors = {
            default: '#e4e4e7',
            success: 'white',
            warning: 'white',
            error: 'white',
            info: 'white',
            primary: 'white'
        };
        return colors[variant] || colors.default;
    }
    
    function getToastBorderColor(variant) {
        const colors = {
            default: 'rgba(99, 116, 141, 0.3)',
            success: 'rgba(34, 197, 94, 0.3)',
            warning: 'rgba(245, 158, 11, 0.3)',
            error: 'rgba(239, 68, 68, 0.3)',
            info: 'rgba(59, 130, 246, 0.3)',
            primary: 'rgba(59, 130, 246, 0.3)'
        };
        return colors[variant] || colors.default;
    }
    
    function getToastIcon(variant) {
        const icons = {
            default: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
            primary: 'ℹ️'
        };
        return icons[variant] || icons.default;
    }
    
    // Add to DOM
    document.body.appendChild(toastElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(toastElement, toastStyles.visible);
    });
    
    // Auto-dismiss if duration is set
    if (config.duration > 0) {
        setTimeout(() => {
            closeToast();
        }, config.duration);
    }
    
    function closeToast() {
        widgetStyleManager.applyStyles(toastElement, toastStyles.hidden);
        setTimeout(() => {
            if (toastElement.parentNode) {
                toastElement.parentNode.removeChild(toastElement);
            }
        }, 300);
    }
    
    toastManager.show(`${type} toast displayed`, 'info');
}

export function createDemoSpinner(type, triggerButton, toastManager) {
    const spinnerConfigs = {
        default: {
            type: 'default',
            size: 'md',
            variant: 'default',
            label: 'Loading...'
        },
        dots: {
            type: 'dots',
            size: 'lg',
            variant: 'primary',
            label: 'Processing...'
        },
        pulse: {
            type: 'pulse',
            size: 'xl',
            variant: 'success',
            label: 'Success!'
        },
        bars: {
            type: 'bars',
            size: 'md',
            variant: 'warning',
            label: 'Analyzing...'
        }
    };
    
    const config = spinnerConfigs[type] || spinnerConfigs.default;
    
    // Create spinner using theme-based styling
    const spinnerStyles = widgetStyleManager.getWidgetStyles('spinner');
    const spinnerElement = widgetStyleManager.createStyledElement('div', spinnerStyles.container, 'plauna-demo-spinner');
    
    // Create spinner animation
    const spinnerContainer = widgetStyleManager.createStyledElement('div', spinnerStyles.spinnerContainer);
    
    // Create spinner based on type
    switch (config.type) {
        case 'dots':
            createDotsSpinner(spinnerContainer);
            break;
        case 'pulse':
            createPulseSpinner(spinnerContainer);
            break;
        case 'bars':
            createBarsSpinner(spinnerContainer);
            break;
        default:
            createDefaultSpinner(spinnerContainer);
            break;
    }
    
    function createDefaultSpinner(container) {
        const spinner = widgetStyleManager.createStyledElement('div', spinnerStyles.spinner);
        widgetStyleManager.applyStyles(spinner, {
            borderTopColor: getSpinnerColor(config.variant)
        });
        container.appendChild(spinner);
    }
    
    function createDotsSpinner(container) {
        const dotsContainer = widgetStyleManager.createStyledElement('div', spinnerStyles.dotsContainer);
        
        for (let i = 0; i < 3; i++) {
            const dot = widgetStyleManager.createStyledElement('div', spinnerStyles.dot);
            widgetStyleManager.applyStyles(dot, {
                background: getSpinnerColor(config.variant),
                animationDelay: `${i * 0.16}s`
            });
            dotsContainer.appendChild(dot);
        }
        
        container.appendChild(dotsContainer);
    }
    
    function createPulseSpinner(container) {
        const pulse = widgetStyleManager.createStyledElement('div', spinnerStyles.pulse);
        widgetStyleManager.applyStyles(pulse, {
            background: getSpinnerColor(config.variant)
        });
        container.appendChild(pulse);
    }
    
    function createBarsSpinner(container) {
        const barsContainer = widgetStyleManager.createStyledElement('div', spinnerStyles.barsContainer);
        
        for (let i = 0; i < 4; i++) {
            const bar = widgetStyleManager.createStyledElement('div', spinnerStyles.bar);
            widgetStyleManager.applyStyles(bar, {
                background: getSpinnerColor(config.variant),
                animationDelay: `${i * 0.1}s`
            });
            barsContainer.appendChild(bar);
        }
        
        container.appendChild(barsContainer);
    }
    
    function getSpinnerColor(variant) {
        const colors = {
            default: '#e4e4e7',
            primary: '#3b82f6',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    // Add CSS animations if not already added
    if (!document.querySelector('#plauna-spinner-animations')) {
        const style = document.createElement('style');
        style.id = 'plauna-spinner-animations';
        style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            @keyframes dot-bounce {
                0%, 80%, 100% { transform: scale(0); }
                40% { transform: scale(1); }
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            @keyframes bar-stretch {
                0%, 40%, 100% { transform: scaleY(0.4); }
                20% { transform: scaleY(1); }
            }
        `;
        document.head.appendChild(style);
    }
    
    spinnerElement.appendChild(spinnerContainer);
    
    // Add label
    const label = widgetStyleManager.createStyledElement('div', spinnerStyles.label);
    label.textContent = config.label;
    spinnerElement.appendChild(label);
    
    // Add to DOM
    document.body.appendChild(spinnerElement);
    
    // Animate in
    requestAnimationFrame(() => {
        widgetStyleManager.applyStyles(spinnerElement, {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)'
        });
    });
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
        widgetStyleManager.applyStyles(spinnerElement, {
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.9)'
        });
        setTimeout(() => {
            if (spinnerElement.parentNode) {
                spinnerElement.parentNode.removeChild(spinnerElement);
            }
        }, 200);
    }, 3000);
    
    toastManager.show(`${type} spinner displayed`, 'info');
}

export function createDemoStatus(type, triggerButton, toastManager) {
    const statusConfigs = {
        default: {
            status: 'online',
            label: 'John Doe',
            description: 'Active now',
            showIcon: true,
            dot: true,
            pulse: true
        },
        offline: {
            status: 'offline',
            label: 'Jane Smith',
            description: 'Last seen 2 hours ago',
            showIcon: true,
            dot: true,
            pulse: false
        },
        busy: {
            status: 'busy',
            label: 'Bob Johnson',
            description: 'In a meeting',
            showIcon: true,
            dot: true,
            pulse: true
        },
        processing: {
            status: 'processing',
            label: 'System Status',
            description: 'Updating...',
            showIcon: true,
            dot: true,
            pulse: true
        }
    };
    
    const config = statusConfigs[type] || statusConfigs.default;
    
    // Create status as a simple DOM element for demo
    const statusElement = document.createElement('div');
    statusElement.className = 'plauna-demo-status';
    statusElement.style.cssText = (
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
    
    // Create status container
    const statusContainer = document.createElement('div');
    statusContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 12px;'
    );
    
    // Create status item
    const statusItem = document.createElement('div');
    statusItem.style.cssText = (
        'display: flex;' +
        'align-items: center;' +
        'gap: 12px;' +
        'padding: 16px;' +
        'background: rgba(255, 255, 255, 0.05);' +
        'border-radius: 8px;' +
        'border: 1px solid rgba(99, 116, 141, 0.2);'
    );
    
    // Create status dot
    if (config.dot) {
        const dot = document.createElement('div');
        dot.style.cssText = (
            'width: 8px;' +
            'height: 8px;' +
            'background: ' + getStatusColor(config.status) + ';' +
            'border-radius: 50%;' +
            'flex-shrink: 0;'
        );
        
        if (config.pulse) {
            dot.style.animation = 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite';
        }
        
        statusItem.appendChild(dot);
    }
    
    // Create status icon
    if (config.showIcon) {
        const icon = document.createElement('span');
        icon.textContent = getStatusIcon(config.status);
        icon.style.cssText = (
            'font-size: 16px;' +
            'color: ' + getStatusColor(config.status) + ';' +
            'flex-shrink: 0;'
        );
        statusItem.appendChild(icon);
    }
    
    // Create text content
    const textContent = document.createElement('div');
    textContent.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 4px;'
    );
    
    // Create label
    const label = document.createElement('div');
    label.textContent = config.label;
    label.style.cssText = (
        'font-size: 14px;' +
        'font-weight: 600;' +
        'color: #e4e4e7;'
    );
    textContent.appendChild(label);
    
    // Create description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 12px;' +
        'color: #94a3b8;' +
        'opacity: 0.8;'
    );
    textContent.appendChild(description);
    
    statusItem.appendChild(textContent);
    statusContainer.appendChild(statusItem);
    
    // Add multiple status examples
    const statusTypes = ['online', 'offline', 'busy', 'away', 'success', 'warning', 'error', 'info'];
    statusTypes.forEach(statusType => {
        const exampleStatus = document.createElement('div');
        exampleStatus.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: 8px;' +
            'padding: 8px 12px;' +
            'background: rgba(255, 255, 255, 0.05);' +
            'border-radius: 6px;' +
            'border: 1px solid rgba(99, 116, 141, 0.2);' +
            'cursor: pointer;' +
            'transition: all 150ms ease;'
        );
        
        exampleStatus.addEventListener('mouseenter', () => {
            exampleStatus.style.background = 'rgba(255, 255, 255, 0.1)';
        });
        
        exampleStatus.addEventListener('mouseleave', () => {
            exampleStatus.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        
        exampleStatus.addEventListener('click', () => {
            toastManager.show(`${statusType} status clicked`, 'info');
        });
        
        // Add dot
        const exampleDot = document.createElement('div');
        exampleDot.style.cssText = (
            'width: 6px;' +
            'height: 6px;' +
            'background: ' + getStatusColor(statusType) + ';' +
            'border-radius: 50%;' +
            'flex-shrink: 0;'
        );
        exampleStatus.appendChild(exampleDot);
        
        // Add label
        const exampleLabel = document.createElement('span');
        exampleLabel.textContent = statusType.charAt(0).toUpperCase() + statusType.slice(1);
        exampleLabel.style.cssText = (
            'font-size: 12px;' +
            'color: #e4e4e7;' +
            'font-weight: 500;'
        );
        exampleStatus.appendChild(exampleLabel);
        
        statusContainer.appendChild(exampleStatus);
    });
    
    statusElement.appendChild(statusContainer);
    
    // Helper functions
    function getStatusColor(status) {
        const colors = {
            default: '#94a3b8',
            online: '#22c55e',
            offline: '#64748b',
            busy: '#f59e0b',
            away: '#3b82f6',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6',
            processing: '#3b82f6'
        };
        return colors[status] || colors.default;
    }
    
    function getStatusIcon(status) {
        const icons = {
            default: '⚪',
            online: '🟢',
            offline: '⚫',
            busy: '⏳',
            away: '🚶',
            success: '✅',
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
            processing: '⚙️'
        };
        return icons[status] || icons.default;
    }
    
    // Add CSS animations if not already added
    if (!document.querySelector('#plauna-pulse-animation')) {
        const style = document.createElement('style');
        style.id = 'plauna-pulse-animation';
        style.textContent = `
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add to DOM
    document.body.appendChild(statusElement);
    
    // Animate in
    requestAnimationFrame(() => {
        statusElement.style.opacity = '1';
        statusElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!statusElement.contains(e.target)) {
                closeStatus();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeStatus();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeStatus() {
        statusElement.style.opacity = '0';
        statusElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (statusElement.parentNode) {
                statusElement.parentNode.removeChild(statusElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} status displayed`, 'info');
}

export function createDemoEmptyState(type, triggerButton, toastManager) {
    const emptyStateConfigs = {
        default: {
            title: 'No Data',
            description: 'There is no data to display at the moment.',
            icon: '📭',
            variant: 'default'
        },
        search: {
            title: 'No Results',
            description: 'No results found for your search.',
            icon: '🔍',
            variant: 'info',
            action: {
                label: 'Clear Filters',
                onClick: () => {
                    toastManager.show('Filters cleared', 'info');
                }
            }
        },
        upload: {
            title: 'No Files Yet',
            description: 'Drag and drop files here or click to upload.',
            icon: '📁',
            variant: 'primary',
            action: {
                label: 'Browse Files',
                onClick: () => {
                    toastManager.show('File browser opened', 'info');
                }
            }
        },
        cart: {
            title: 'Cart is Empty',
            description: 'Add items to your cart to get started.',
            icon: '🛒',
            variant: 'success',
            action: {
                label: 'Start Shopping',
                onClick: () => {
                    toastManager.show('Shopping started', 'info');
                }
            }
        }
    };
    
    const config = emptyStateConfigs[type] || emptyStateConfigs.default;
    
    // Create empty state as a simple DOM element for demo
    const emptyStateElement = document.createElement('div');
    emptyStateElement.className = 'plauna-demo-emptystate';
    emptyStateElement.style.cssText = (
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
        'min-width: 400px;' +
        'max-width: 500px;'
    );
    
    // Create empty state container
    const emptyStateContainer = document.createElement('div');
    emptyStateContainer.style.cssText = (
        'display: flex;' +
        'flex-direction: column;' +
        'align-items: center;' +
        'gap: 16px;' +
        'text-align: center;'
    );
    
    // Create icon
    const icon = document.createElement('div');
    icon.textContent = config.icon;
    icon.style.cssText = (
        'font-size: 64px;' +
        'opacity: 0.7;' +
        'margin-bottom: 8px;' +
        'color: ' + getEmptyStateColor(config.variant) + ';'
    );
    emptyStateContainer.appendChild(icon);
    
    // Create title
    const title = document.createElement('div');
    title.textContent = config.title;
    title.style.cssText = (
        'font-size: 20px;' +
        'font-weight: 600;' +
        'color: ' + getEmptyStateColor(config.variant) + ';' +
        'margin-bottom: 8px;'
    );
    emptyStateContainer.appendChild(title);
    
    // Create description
    const description = document.createElement('div');
    description.textContent = config.description;
    description.style.cssText = (
        'font-size: 14px;' +
        'color: #94a3b8;' +
        'line-height: 1.4;' +
        'opacity: 0.8;' +
        'margin-bottom: 24px;'
    );
    emptyStateContainer.appendChild(description);
    
    // Create action button if present
    if (config.action) {
        const actionButton = document.createElement('button');
        actionButton.textContent = config.action.label;
        actionButton.style.cssText = (
            'background: ' + getEmptyStateBackgroundColor(config.variant) + ';' +
            'color: ' + getEmptyStateTextColor(config.variant) + ';' +
            'border: 1px solid ' + getEmptyStateBorderColor(config.variant) + ';' +
            'border-radius: 8px;' +
            'padding: 12px 24px;' +
            'font-size: 14px;' +
            'font-weight: 500;' +
            'cursor: pointer;' +
            'transition: all 150ms ease;' +
            'text-decoration: none;'
        );
        
        actionButton.addEventListener('mouseenter', () => {
            actionButton.style.transform = 'translateY(-1px)';
            actionButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        });
        
        actionButton.addEventListener('mouseleave', () => {
            actionButton.style.transform = 'translateY(0)';
            actionButton.style.boxShadow = 'none';
        });
        
        actionButton.addEventListener('click', () => {
            if (config.action.onClick) {
                config.action.onClick();
            }
        });
        
        emptyStateContainer.appendChild(actionButton);
    }
    
    emptyStateElement.appendChild(emptyStateContainer);
    
    // Helper functions
    function getEmptyStateColor(variant) {
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
    
    function getEmptyStateBackgroundColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.1)',
            primary: '#3b82f6',
            secondary: '#6b7280',
            success: '#22c55e',
            warning: '#f59e0b',
            error: '#ef4444',
            info: '#3b82f6'
        };
        return colors[variant] || colors.default;
    }
    
    function getEmptyStateTextColor(variant) {
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
    
    function getEmptyStateBorderColor(variant) {
        const colors = {
            default: 'rgba(255, 255, 255, 0.2)',
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
    document.body.appendChild(emptyStateElement);
    
    // Animate in
    requestAnimationFrame(() => {
        emptyStateElement.style.opacity = '1';
        emptyStateElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!emptyStateElement.contains(e.target)) {
                closeEmptyState();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeEmptyState();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeEmptyState() {
        emptyStateElement.style.opacity = '0';
        emptyStateElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (emptyStateElement.parentNode) {
                emptyStateElement.parentNode.removeChild(emptyStateElement);
            }
        }, 200);
    }
    
    toastManager.show(`${type} empty state displayed`, 'info');
}
