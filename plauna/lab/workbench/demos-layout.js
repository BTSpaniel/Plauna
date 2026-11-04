// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab demos: container, section, panel, collapse, header/footer, grid.
 * Split out of lab/workbench-lab.js.
 */


export function createDemoContainer(type, triggerButton, toastManager) {
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
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const containerConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'primary',
            title: 'Default Container',
            description: 'Basic container with default styling'
        },
        card: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'primary',
            shadow: 'sm',
            borderRadius: 'md',
            title: 'Card Container',
            description: 'Card-style container with border and shadow'
        },
        elevated: {
            variant: 'elevated',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'primary',
            shadow: 'lg',
            borderRadius: 'lg',
            hoverable: true,
            title: 'Elevated Container',
            description: 'Container with elevated shadow effect'
        },
        outlined: {
            variant: 'outlined',
            size: 'md',
            padding: 'md',
            display: 'block',
            background: 'transparent',
            borderRadius: 'md',
            title: 'Outlined Container',
            description: 'Container with outlined border style'
        },
        flex: {
            variant: 'default',
            size: 'md',
            padding: 'md',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'secondary',
            title: 'Flex Container',
            description: 'Flexbox layout container with alignment'
        },
        grid: {
            variant: 'card',
            size: 'md',
            padding: 'md',
            display: 'grid',
            gap: 'md',
            background: 'primary',
            title: 'Grid Container',
            description: 'Grid layout container with auto-fit columns'
        },
        glass: {
            variant: 'glass',
            size: 'md',
            padding: 'lg',
            display: 'block',
            background: 'transparent',
            title: 'Glass Container',
            description: 'Container with glassmorphism effect'
        },
        hero: {
            variant: 'default',
            size: 'xl',
            padding: 'xxxl',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'primary',
            title: 'Hero Container',
            description: 'Hero section container with centered content'
        }
    };
    
    const config = containerConfigs[type] || containerConfigs.default;
    
    // Create container as a simple DOM element for demo
    const containerElement = document.createElement('div');
    containerElement.className = 'plauna-demo-container';
    containerElement.style.cssText = (
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
    title.textContent = 'Container Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    containerElement.appendChild(title);
    
    // Create demo container
    const demoContainer = document.createElement('div');
    demoContainer.style.cssText = getContainerStyles(config);
    
    // Add content to demo container
    if (config.display === 'flex') {
        // Add flex items
        const flexItems = [
            { text: 'Item 1', background: tokens.get('colors.primary') },
            { text: 'Item 2', background: tokens.get('colors.secondary') },
            { text: 'Item 3', background: tokens.get('colors.accent') }
        ];
        
        flexItems.forEach(item => {
            const flexItem = document.createElement('div');
            flexItem.textContent = item.text;
            flexItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'background: ' + item.background + ';' +
                'color: white;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'text-align: center;'
            );
            demoContainer.appendChild(flexItem);
        });
    } else if (config.display === 'grid') {
        // Add grid items
        const gridItems = [
            { text: 'Grid 1', background: tokens.get('colors.primary') },
            { text: 'Grid 2', background: tokens.get('colors.secondary') },
            { text: 'Grid 3', background: tokens.get('colors.accent') },
            { text: 'Grid 4', background: tokens.get('colors.primary') },
            { text: 'Grid 5', background: tokens.get('colors.secondary') },
            { text: 'Grid 6', background: tokens.get('colors.accent') }
        ];
        
        gridItems.forEach(item => {
            const gridItem = document.createElement('div');
            gridItem.textContent = item.text;
            gridItem.style.cssText = (
                'padding: ' + tokens.get('spacing.md') + ';' +
                'background: ' + item.background + ';' +
                'color: white;' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'text-align: center;' +
                'min-height: 80px;'
            );
            demoContainer.appendChild(gridItem);
        });
    } else {
        // Add default content
        const contentTitle = document.createElement('h3');
        contentTitle.textContent = config.title;
        contentTitle.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'color: ' + tokens.get('colors.text.primary') + ';' +
            'margin: 0 0 ' + tokens.get('spacing.sm') + ' 0;'
        );
        demoContainer.appendChild(contentTitle);
        
        const contentDesc = document.createElement('p');
        contentDesc.textContent = config.description;
        contentDesc.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'margin: 0 0 ' + tokens.get('spacing.md') + ' 0;' +
            'line-height: 1.5;'
        );
        demoContainer.appendChild(contentDesc);
        
        // Add sample content
        const sampleContent = document.createElement('div');
        sampleContent.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        const sampleItem1 = document.createElement('div');
        sampleItem1.textContent = 'Sample content item 1';
        sampleItem1.style.cssText = (
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: ' + tokens.get('colors.surface') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';'
        );
        sampleContent.appendChild(sampleItem1);
        
        const sampleItem2 = document.createElement('div');
        sampleItem2.textContent = 'Sample content item 2';
        sampleItem2.style.cssText = (
            'padding: ' + tokens.get('spacing.sm') + ';' +
            'background: ' + tokens.get('colors.surface') + ';' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';'
        );
        sampleContent.appendChild(sampleItem2);
        
        demoContainer.appendChild(sampleContent);
    }
    
    containerElement.appendChild(demoContainer);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
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
    
    closeButton.addEventListener('click', closeContainer);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    containerElement.appendChild(controls);
    
    // Helper function for container styles
    function getContainerStyles(config) {
        let styles = (
            'display: ' + config.display + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'background: ' + getBackgroundColor(config.background) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'md') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'border: ' + getBorderValue(config.variant) + ';' +
            'min-height: 200px;'
        );
        
        if (config.display === 'flex') {
            styles += (
                'flex-direction: ' + (config.flexDirection || 'row') + ';' +
                'justify-content: ' + (config.justifyContent || 'flex-start') + ';' +
                'align-items: ' + (config.alignItems || 'stretch') + ';' +
                'gap: ' + getGapValue(config.gap || 'md') + ';'
            );
        } else if (config.display === 'grid') {
            styles += (
                'grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));' +
                'gap: ' + getGapValue(config.gap || 'md') + ';'
            );
        } else if (config.display === 'flex' && config.flexDirection === 'column') {
            styles += (
                'flex-direction: ' + (config.flexDirection || 'column') + ';' +
                'justify-content: ' + (config.justifyContent || 'flex-start') + ';' +
                'align-items: ' + (config.alignItems || 'stretch') + ';' +
                'gap: ' + getGapValue(config.gap || 'md') + ';'
            );
        }
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.md;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.md;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant) {
        if (variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (variant === 'glass') {
            return '1px solid rgba(255, 255, 255, 0.2)';
        } else if (variant === 'card') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    function getBackgroundColor(background) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getGapValue(gap) {
        const gaps = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return gaps[gap] || gaps.none;
    }
    
    // Add hover effect if hoverable
    if (config.hoverable) {
        demoContainer.addEventListener('mouseenter', () => {
            demoContainer.style.transform = 'translateY(-2px)';
            demoContainer.style.boxShadow = getEnhancedShadow(config.shadow || 'none');
        });
        
        demoContainer.addEventListener('mouseleave', () => {
            demoContainer.style.transform = 'translateY(0)';
            demoContainer.style.boxShadow = getShadowValue(config.shadow || 'none');
        });
    }
    
    function getEnhancedShadow(shadow) {
        const baseShadow = getShadowValue(shadow);
        if (baseShadow === 'none') {
            return '0 4px 6px rgba(0, 0, 0, 0.1)';
        }
        return baseShadow.replace('0.1', '0.15').replace('0.05', '0.08');
    }
    
    // Add to DOM
    document.body.appendChild(containerElement);
    
    // Animate in
    requestAnimationFrame(() => {
        containerElement.style.opacity = '1';
        containerElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!containerElement.contains(e.target)) {
                closeContainer();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeContainer();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeContainer() {
        containerElement.style.opacity = '0';
        containerElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (containerElement.parentNode) {
                containerElement.parentNode.removeChild(containerElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} container displayed`, 'info');
}

export function createDemoSection(type, triggerButton, toastManager) {
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
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const sectionConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'xl',
            margin: 'lg',
            background: 'primary',
            heading: 'Default Section',
            subheading: 'Standard content section',
            description: 'This is a default section with basic styling and content organization.',
            showHeader: true,
            showFooter: false,
            title: 'Default Section'
        },
        hero: {
            variant: 'primary',
            size: 'xl',
            padding: 'xxxl',
            background: 'primary',
            alignment: 'center',
            heading: 'Hero Section',
            subheading: 'Welcome to Our Platform',
            description: 'A powerful hero section with centered content and primary styling.',
            showHeader: true,
            showFooter: false,
            title: 'Hero Section'
        },
        feature: {
            variant: 'muted',
            size: 'lg',
            padding: 'xl',
            background: 'secondary',
            heading: 'Feature Section',
            subheading: 'Key Features',
            description: 'Grid-based feature section with muted background and organized content.',
            showHeader: true,
            showFooter: false,
            display: 'grid',
            title: 'Feature Section'
        },
        testimonial: {
            variant: 'elevated',
            size: 'md',
            padding: 'xl',
            background: 'primary',
            alignment: 'center',
            heading: 'Testimonial Section',
            subheading: 'What Our Users Say',
            description: 'Elevated testimonial section with centered alignment and shadow effects.',
            showHeader: true,
            showFooter: true,
            footerContent: '— John Doe, CEO',
            title: 'Testimonial Section'
        },
        cta: {
            variant: 'accent',
            size: 'md',
            padding: 'xl',
            background: 'accent',
            alignment: 'center',
            heading: 'Call to Action',
            subheading: 'Get Started Today',
            description: 'Accent-colored call-to-action section with centered content and footer.',
            showHeader: true,
            showFooter: true,
            footerContent: 'Start Free Trial →',
            title: 'Call to Action Section'
        },
        sidebar: {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            heading: 'Sidebar Section',
            subheading: 'Navigation',
            description: 'Outlined sidebar section with transparent background and border styling.',
            showHeader: true,
            showFooter: false,
            title: 'Sidebar Section'
        },
        footer: {
            variant: 'secondary',
            size: 'md',
            padding: 'xl',
            background: 'secondary',
            heading: 'Footer Section',
            subheading: 'Site Information',
            description: 'Secondary footer section with top separator and horizontal layout.',
            showHeader: true,
            showFooter: true,
            footerContent: '© 2024 Your Company',
            separators: 'top',
            title: 'Footer Section'
        },
        header: {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            heading: 'Header Section',
            subheading: 'Site Navigation',
            description: 'Header section with bottom separator and horizontal layout.',
            showHeader: true,
            showFooter: false,
            separators: 'bottom',
            title: 'Header Section'
        }
    };
    
    const config = sectionConfigs[type] || sectionConfigs.default;
    
    // Create section as a simple DOM element for demo
    const sectionElement = document.createElement('div');
    sectionElement.className = 'plauna-demo-section';
    sectionElement.style.cssText = (
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
    title.textContent = 'Section Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    sectionElement.appendChild(title);
    
    // Create demo section
    const demoSection = document.createElement('div');
    demoSection.style.cssText = getSectionStyles(config);
    
    // Add header if needed
    if (config.showHeader && (config.heading || config.subheading || config.description)) {
        const header = document.createElement('header');
        header.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.sm') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';' +
            'text-align: ' + config.alignment + ';'
        );
        
        // Add heading
        if (config.heading) {
            const headingElement = document.createElement('h2');
            headingElement.textContent = config.heading;
            headingElement.style.cssText = (
                'font-size: 24px;' +
                'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
                'color: ' + getHeadingColor(config.variant) + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            header.appendChild(headingElement);
        }
        
        // Add subheading
        if (config.subheading) {
            const subheadingElement = document.createElement('p');
            subheadingElement.textContent = config.subheading;
            subheadingElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + getSubheadingColor(config.variant) + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            header.appendChild(subheadingElement);
        }
        
        // Add description
        if (config.description) {
            const descriptionElement = document.createElement('p');
            descriptionElement.textContent = config.description;
            descriptionElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.md') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + getDescriptionColor(config.variant) + ';' +
                'margin: 0;' +
                'line-height: 1.6;'
            );
            header.appendChild(descriptionElement);
        }
        
        demoSection.appendChild(header);
    }
    
    // Add main content area
    const main = document.createElement('main');
    main.style.cssText = (
        'flex: 1;' +
        'display: ' + (config.display === 'grid' ? 'grid' : 'flex') + ';' +
        (config.display === 'grid' ? 
            'grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));' :
            'flex-direction: column;') +
        'gap: ' + tokens.get('spacing.md') + ';'
    );
    
    // Add sample content
    const contentItems = [
        { text: 'Content Item 1', background: tokens.get('colors.primary') },
        { text: 'Content Item 2', background: tokens.get('colors.secondary') },
        { text: 'Content Item 3', background: tokens.get('colors.accent') }
    ];
    
    contentItems.forEach(item => {
        const contentItem = document.createElement('div');
        contentItem.textContent = item.text;
        contentItem.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ';' +
            'background: ' + item.background + ';' +
            'color: white;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'min-height: 60px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;'
        );
        main.appendChild(contentItem);
    });
    
    demoSection.appendChild(main);
    
    // Add footer if needed
    if (config.showFooter && config.footerContent) {
        const footer = document.createElement('footer');
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: ' + (config.alignment === 'center' ? 'center' : config.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
            'margin-top: ' + tokens.get('spacing.lg') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + getDescriptionColor(config.variant) + ';'
        );
        footer.textContent = config.footerContent;
        demoSection.appendChild(footer);
    }
    
    sectionElement.appendChild(demoSection);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
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
    
    closeButton.addEventListener('click', closeSection);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    sectionElement.appendChild(controls);
    
    // Helper function for section styles
    function getSectionStyles(config) {
        let styles = (
            'display: ' + (config.display || 'block') + ';' +
            'flex-direction: ' + (config.flexDirection || 'column') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'margin: ' + getMarginValue(config.margin) + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'none') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'border: ' + getBorderValue(config.variant) + ';' +
            'min-height: 300px;' +
            'text-align: ' + config.alignment + ';'
        );
        
        if (config.separators === 'top' || config.separators === 'both') {
            styles += 'border-top: 1px solid ' + tokens.get('colors.border.light') + ';';
        }
        if (config.separators === 'bottom' || config.separators === 'both') {
            styles += 'border-bottom: 1px solid ' + tokens.get('colors.border.light') + ';';
        }
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.lg;
    }
    
    function getMarginValue(margin) {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[margin] || margins.lg;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.none;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant) {
        if (variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (variant === 'elevated') {
            return '1px solid ' + tokens.get('colors.border.light');
        }
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getHeadingColor(variant) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.text.inverse'),
            secondary: tokens.get('colors.text.inverse'),
            accent: tokens.get('colors.text.inverse'),
            muted: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    function getSubheadingColor(variant) {
        const colors = {
            default: tokens.get('colors.text.secondary'),
            primary: 'rgba(255, 255, 255, 0.9)',
            secondary: 'rgba(255, 255, 255, 0.9)',
            accent: 'rgba(255, 255, 255, 0.9)',
            muted: tokens.get('colors.text.secondary'),
            outlined: tokens.get('colors.text.secondary'),
            elevated: tokens.get('colors.text.secondary')
        };
        return colors[variant] || colors.default;
    }
    
    function getDescriptionColor(variant) {
        const colors = {
            default: tokens.get('colors.text.secondary'),
            primary: 'rgba(255, 255, 255, 0.8)',
            secondary: 'rgba(255, 255, 255, 0.8)',
            accent: 'rgba(255, 255, 255, 0.8)',
            muted: tokens.get('colors.text.secondary'),
            outlined: tokens.get('colors.text.secondary'),
            elevated: tokens.get('colors.text.secondary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(sectionElement);
    
    // Animate in
    requestAnimationFrame(() => {
        sectionElement.style.opacity = '1';
        sectionElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!sectionElement.contains(e.target)) {
                closeSection();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeSection();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeSection() {
        sectionElement.style.opacity = '0';
        sectionElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (sectionElement.parentNode) {
                sectionElement.parentNode.removeChild(sectionElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} section displayed`, 'info');
}

export function createDemoPanel(type, triggerButton, toastManager) {
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
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const panelConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            title: 'Default Panel',
            subtitle: 'Standard panel layout',
            showHeader: true,
            showFooter: false,
            showActions: false,
            title: 'Default Panel'
        },
        card: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            shadow: 'sm',
            borderRadius: 'md',
            title: 'Card Panel',
            subtitle: 'Card-style panel with shadow',
            showHeader: true,
            showFooter: true,
            footerContent: 'Card footer content',
            showActions: true,
            title: 'Card Panel'
        },
        elevated: {
            variant: 'elevated',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            shadow: 'md',
            borderRadius: 'lg',
            hoverable: true,
            title: 'Elevated Panel',
            subtitle: 'Panel with elevated shadow effect',
            showHeader: true,
            showFooter: false,
            showActions: true,
            title: 'Elevated Panel'
        },
        outlined: {
            variant: 'outlined',
            size: 'md',
            padding: 'md',
            background: 'transparent',
            borderRadius: 'md',
            title: 'Outlined Panel',
            subtitle: 'Panel with outlined border',
            showHeader: true,
            showFooter: false,
            showActions: false,
            title: 'Outlined Panel'
        },
        glass: {
            variant: 'glass',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            borderRadius: 'lg',
            hoverable: true,
            title: 'Glass Panel',
            subtitle: 'Panel with glassmorphism effect',
            showHeader: true,
            showFooter: false,
            showActions: true,
            title: 'Glass Panel'
        },
        sidebar: {
            variant: 'outlined',
            size: 'sm',
            padding: 'md',
            background: 'primary',
            borderRadius: 'sm',
            display: 'flex',
            flexDirection: 'column',
            gap: 'sm',
            title: 'Sidebar Panel',
            subtitle: 'Navigation panel',
            showHeader: true,
            showFooter: false,
            showActions: false,
            title: 'Sidebar Panel'
        },
        collapsible: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            shadow: 'sm',
            borderRadius: 'md',
            collapsible: true,
            collapsed: false,
            title: 'Collapsible Panel',
            subtitle: 'Panel with collapse functionality',
            showHeader: true,
            showFooter: false,
            showActions: true,
            title: 'Collapsible Panel'
        },
        dashboard: {
            variant: 'elevated',
            size: 'lg',
            padding: 'lg',
            background: 'primary',
            shadow: 'md',
            borderRadius: 'lg',
            display: 'grid',
            gap: 'lg',
            title: 'Dashboard Panel',
            subtitle: 'Grid-based dashboard layout',
            showHeader: true,
            showFooter: true,
            footerContent: 'Last updated: Just now',
            showActions: true,
            title: 'Dashboard Panel'
        }
    };
    
    const config = panelConfigs[type] || panelConfigs.default;
    
    // Create panel as a simple DOM element for demo
    const panelElement = document.createElement('div');
    panelElement.className = 'plauna-demo-panel';
    panelElement.style.cssText = (
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
    title.textContent = 'Panel Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    panelElement.appendChild(title);
    
    // Create demo panel
    const demoPanel = document.createElement('div');
    demoPanel.style.cssText = getPanelStyles(config);
    
    // Add header if needed
    if (config.showHeader && (config.title || config.subtitle || config.showActions)) {
        const header = document.createElement('div');
        header.style.cssText = (
            'display: flex;' +
            'justify-content: space-between;' +
            'align-items: flex-start;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'margin-bottom: ' + tokens.get('spacing.lg') + ';'
        );
        
        // Create title section
        const titleSection = document.createElement('div');
        titleSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'flex: 1;'
        );
        
        // Add title
        if (config.title) {
            const titleElement = document.createElement('h3');
            titleElement.textContent = config.title;
            titleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: ' + getPanelTextColor(config.variant, config.background) + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            titleSection.appendChild(titleElement);
        }
        
        // Add subtitle
        if (config.subtitle) {
            const subtitleElement = document.createElement('p');
            subtitleElement.textContent = config.subtitle;
            subtitleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            titleSection.appendChild(subtitleElement);
        }
        
        header.appendChild(titleSection);
        
        // Add actions if needed
        if (config.showActions) {
            const actionsSection = document.createElement('div');
            actionsSection.style.cssText = (
                'display: flex;' +
                'gap: ' + tokens.get('spacing.sm') + ';' +
                'align-items: center;'
            );
            
            const actionButton1 = document.createElement('button');
            actionButton1.textContent = 'Edit';
            actionButton1.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: transparent;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'border: 1px solid ' + tokens.get('colors.border.medium') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            actionButton1.addEventListener('click', () => {
                toastManager.show('Edit action clicked', 'info');
            });
            
            const actionButton2 = document.createElement('button');
            actionButton2.textContent = 'Delete';
            actionButton2.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: ' + tokens.get('colors.primary') + ';' +
                'color: ' + tokens.get('colors.text.inverse') + ';' +
                'border: 1px solid ' + tokens.get('colors.primary') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.xs') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            actionButton2.addEventListener('click', () => {
                toastManager.show('Delete action clicked', 'warning');
            });
            
            actionsSection.appendChild(actionButton1);
            actionsSection.appendChild(actionButton2);
            header.appendChild(actionsSection);
        }
        
        // Add collapse toggle if collapsible
        if (config.collapsible) {
            const collapseToggle = document.createElement('button');
            collapseToggle.textContent = config.collapsed ? '▼' : '▲';
            collapseToggle.style.cssText = (
                'background: transparent;' +
                'border: none;' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;' +
                'padding: ' + tokens.get('spacing.xs') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;'
            );
            
            collapseToggle.addEventListener('click', () => {
                config.collapsed = !config.collapsed;
                collapseToggle.textContent = config.collapsed ? '▼' : '▲';
                main.style.display = config.collapsed ? 'none' : '';
                toastManager.show('Panel ' + (config.collapsed ? 'collapsed' : 'expanded'), 'info');
            });
            
            header.appendChild(collapseToggle);
        }
        
        demoPanel.appendChild(header);
    }
    
    // Add main content area
    const main = document.createElement('div');
    main.style.cssText = (
        'flex: 1;' +
        'display: ' + (config.display === 'grid' ? 'grid' : 'flex') + ';' +
        (config.display === 'grid' ? 
            'grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));' :
            'flex-direction: ' + (config.flexDirection || 'column') + ';') +
        'gap: ' + tokens.get('spacing.md') + ';'
    );
    
    // Add sample content
    const contentItems = [
        { text: 'Panel Content 1', background: tokens.get('colors.primary') },
        { text: 'Panel Content 2', background: tokens.get('colors.secondary') },
        { text: 'Panel Content 3', background: tokens.get('colors.accent') }
    ];
    
    contentItems.forEach(item => {
        const contentItem = document.createElement('div');
        contentItem.textContent = item.text;
        contentItem.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ';' +
            'background: ' + item.background + ';' +
            'color: white;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'min-height: 60px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;'
        );
        main.appendChild(contentItem);
    });
    
    demoPanel.appendChild(main);
    
    // Add footer if needed
    if (config.showFooter && config.footerContent) {
        const footer = document.createElement('div');
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: flex-start;' +
            'margin-top: ' + tokens.get('spacing.lg') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        footer.textContent = config.footerContent;
        demoPanel.appendChild(footer);
    }
    
    panelElement.appendChild(demoPanel);
    
    // Add hover effect if hoverable
    if (config.hoverable) {
        demoPanel.addEventListener('mouseenter', () => {
            demoPanel.style.transform = 'translateY(-2px)';
            demoPanel.style.boxShadow = getEnhancedShadow(config.shadow || 'none');
        });
        
        demoPanel.addEventListener('mouseleave', () => {
            demoPanel.style.transform = 'translateY(0)';
            demoPanel.style.boxShadow = getShadowValue(config.shadow || 'none');
        });
    }
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
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
    
    closeButton.addEventListener('click', closePanel);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    panelElement.appendChild(controls);
    
    // Helper function for panel styles
    function getPanelStyles(config) {
        let styles = (
            'display: ' + (config.display || 'block') + ';' +
            'flex-direction: ' + (config.flexDirection || 'column') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'margin: ' + getMarginValue(config.margin || 'none') + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'md') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'border: ' + getBorderValue(config.variant) + ';' +
            'min-height: 250px;' +
            'text-align: left;'
        );
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.lg;
    }
    
    function getMarginValue(margin) {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[margin] || margins.none;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.md;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 3px rgba(0, 0, 0, 0.1)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getEnhancedShadow(shadow) {
        const baseShadow = getShadowValue(shadow);
        if (baseShadow === 'none') {
            return '0 4px 6px rgba(0, 0, 0, 0.1)';
        }
        return baseShadow.replace('0.1', '0.15').replace('0.05', '0.08');
    }
    
    function getBorderValue(variant) {
        if (variant === 'outlined') {
            return '2px solid ' + tokens.get('colors.border.medium');
        } else if (variant === 'glass') {
            return '1px solid rgba(255, 255, 255, 0.2)';
        } else if (variant === 'card') {
            return '1px solid ' + tokens.get('colors.border.light');
        } else if (variant === 'bordered') {
            return '2px solid ' + tokens.get('colors.border.medium');
        }
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getPanelTextColor(variant, background) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            card: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            filled: tokens.get('colors.text.primary'),
            glass: tokens.get('colors.text.primary'),
            bordered: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(panelElement);
    
    // Animate in
    requestAnimationFrame(() => {
        panelElement.style.opacity = '1';
        panelElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!panelElement.contains(e.target)) {
                closePanel();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closePanel();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closePanel() {
        panelElement.style.opacity = '0';
        panelElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (panelElement.parentNode) {
                panelElement.parentNode.removeChild(panelElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} panel displayed`, 'info');
}

export function createDemoCollapse(type, triggerButton, toastManager) {
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
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const collapseConfigs = {
        default: {
            variant: 'default',
            size: 'md',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Default Collapse',
            subtitle: 'Click to expand/collapse',
            showHeader: true,
            showFooter: false,
            title: 'Default Collapse'
        },
        card: {
            variant: 'card',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            collapsed: false,
            animationDuration: '250ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Card Collapse',
            subtitle: 'Card-style collapsible content',
            showHeader: true,
            showFooter: true,
            footerContent: 'Footer content here',
            title: 'Card Collapse'
        },
        outlined: {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            collapsed: false,
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Outlined Collapse',
            subtitle: 'Outlined border style',
            showHeader: true,
            showFooter: false,
            title: 'Outlined Collapse'
        },
        accordion: {
            variant: 'bordered',
            size: 'md',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '200ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Accordion Item',
            subtitle: 'Accordion-style collapse',
            showHeader: true,
            showFooter: false,
            border: 'bottom',
            title: 'Accordion Item'
        },
        faq: {
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            collapsed: true,
            animationDuration: '300ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'FAQ Collapse',
            subtitle: 'Frequently asked question',
            showHeader: true,
            showFooter: false,
            title: 'FAQ Collapse'
        },
        sidebar: {
            variant: 'ghost',
            size: 'sm',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '200ms',
            showIcon: true,
            iconPosition: 'left',
            title: 'Sidebar Collapse',
            subtitle: 'Sidebar navigation item',
            showHeader: true,
            showFooter: false,
            title: 'Sidebar Collapse'
        },
        nested: {
            variant: 'bordered',
            size: 'sm',
            padding: 'md',
            background: 'primary',
            collapsed: false,
            animationDuration: '250ms',
            showIcon: true,
            iconPosition: 'right',
            title: 'Nested Collapse',
            subtitle: 'Nested content with accent border',
            showHeader: true,
            showFooter: false,
            border: 'left',
            borderWidth: '3px',
            title: 'Nested Collapse'
        },
        animated: {
            variant: 'card',
            size: 'lg',
            padding: 'xl',
            background: 'primary',
            collapsed: false,
            animationDuration: '400ms',
            animationEasing: 'ease-in-out',
            showIcon: true,
            iconPosition: 'right',
            title: 'Animated Collapse',
            subtitle: 'Slow animation with easing',
            showHeader: true,
            showFooter: true,
            footerContent: 'Animation duration: 400ms',
            title: 'Animated Collapse'
        }
    };
    
    const config = collapseConfigs[type] || collapseConfigs.default;
    
    // Create collapse as a simple DOM element for demo
    const collapseElement = document.createElement('div');
    collapseElement.className = 'plauna-demo-collapse';
    collapseElement.style.cssText = (
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
    title.textContent = 'Collapse Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    collapseElement.appendChild(title);
    
    // Create demo collapse
    const demoCollapse = document.createElement('div');
    demoCollapse.style.cssText = getCollapseStyles(config);
    demoCollapse.setAttribute('aria-expanded', (!config.collapsed).toString());
    demoCollapse.setAttribute('aria-controls', 'demo-collapse-content');
    
    // Add header if needed
    if (config.showHeader && (config.title || config.subtitle)) {
        const header = document.createElement('div');
        header.className = 'plauna-collapse__header';
        header.id = 'demo-collapse-header';
        header.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: space-between;' +
            'gap: ' + tokens.get('spacing.md') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'cursor: pointer;' +
            'user-select: none;'
        );
        
        // Create title section
        const titleSection = document.createElement('div');
        titleSection.className = 'plauna-collapse__title-section';
        titleSection.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.get('spacing.xs') + ';' +
            'flex: 1;'
        );
        
        // Add icon if positioned on left
        if (config.showIcon && config.iconPosition === 'left') {
            const icon = createIcon(config.collapsed, config.iconCollapsed, config.iconExpanded);
            titleSection.appendChild(icon);
        }
        
        // Add title
        if (config.title) {
            const titleElement = document.createElement('h3');
            titleElement.textContent = config.title;
            titleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.lg') + ';' +
                'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
                'color: ' + getCollapseTextColor(config.variant, config.background) + ';' +
                'margin: 0;' +
                'line-height: 1.2;'
            );
            titleSection.appendChild(titleElement);
        }
        
        // Add subtitle
        if (config.subtitle) {
            const subtitleElement = document.createElement('p');
            subtitleElement.textContent = config.subtitle;
            subtitleElement.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.normal') + ';' +
                'color: ' + tokens.get('colors.text.secondary') + ';' +
                'margin: 0;' +
                'line-height: 1.4;'
            );
            titleSection.appendChild(subtitleElement);
        }
        
        header.appendChild(titleSection);
        
        // Add icon if positioned on right
        if (config.showIcon && config.iconPosition === 'right') {
            const icon = createIcon(config.collapsed, config.iconCollapsed, config.iconExpanded);
            header.appendChild(icon);
        }
        
        // Add click handler to header
        header.addEventListener('click', () => {
            toggleCollapse();
        });
        
        demoCollapse.appendChild(header);
    }
    
    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'plauna-collapse__content-container';
    contentContainer.id = 'demo-collapse-content';
    contentContainer.setAttribute('role', 'region');
    contentContainer.setAttribute('aria-labelledby', 'demo-collapse-header');
    contentContainer.style.cssText = (
        'overflow: hidden;' +
        'transition: max-height ' + config.animationDuration + ' ' + config.animationEasing + ', opacity ' + config.animationDuration + ' ' + config.animationEasing + ';' +
        'max-height: ' + (config.collapsed ? '0px' : '500px') + ';' +
        'opacity: ' + (config.collapsed ? '0' : '1') + ';'
    );
    
    // Create content area
    const content = document.createElement('div');
    content.className = 'plauna-collapse__content';
    content.style.cssText = (
        'padding: ' + (config.showHeader ? '0' : getPaddingValue(config.padding)) + ';' +
        'padding-top: ' + (config.showHeader ? '0' : getPaddingValue(config.padding)) + ';'
    );
    
    // Add sample content
    const contentItems = [
        { text: 'Collapsible Content 1', background: tokens.get('colors.primary') },
        { text: 'Collapsible Content 2', background: tokens.get('colors.secondary') },
        { text: 'Collapsible Content 3', background: tokens.get('colors.accent') }
    ];
    
    contentItems.forEach(item => {
        const contentItem = document.createElement('div');
        contentItem.textContent = item.text;
        contentItem.style.cssText = (
            'padding: ' + tokens.get('spacing.md') + ';' +
            'background: ' + item.background + ';' +
            'color: white;' +
            'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
            'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
            'text-align: center;' +
            'min-height: 60px;' +
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'margin-bottom: ' + tokens.get('spacing.sm') + ';'
        );
        content.appendChild(contentItem);
    });
    
    contentContainer.appendChild(content);
    demoCollapse.appendChild(contentContainer);
    
    // Add footer if needed
    if (config.showFooter && config.footerContent) {
        const footer = document.createElement('div');
        footer.className = 'plauna-collapse__footer';
        footer.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: flex-start;' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'padding-top: 0;' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';'
        );
        footer.textContent = config.footerContent;
        demoCollapse.appendChild(footer);
    }
    
    collapseElement.appendChild(demoCollapse);
    
    // Helper function to create icon
    function createIcon(collapsed, iconCollapsed, iconExpanded) {
        const icon = document.createElement('div');
        icon.className = 'plauna-collapse__icon';
        icon.textContent = collapsed ? iconCollapsed : iconExpanded;
        icon.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 20px;' +
            'height: 20px;' +
            'font-size: ' + tokens.get('fontSizes.sm') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'transition: transform ' + config.animationDuration + ' ' + config.animationEasing + ';' +
            'transform: rotate(' + (collapsed ? '0deg' : '180deg') + ');'
        );
        return icon;
    }
    
    // Toggle function
    function toggleCollapse() {
        config.collapsed = !config.collapsed;
        demoCollapse.setAttribute('aria-expanded', (!config.collapsed).toString());
        
        // Update content container
        if (contentContainer) {
            if (config.collapsed) {
                contentContainer.style.maxHeight = '0px';
                contentContainer.style.opacity = '0';
            } else {
                // Get the actual height
                const contentHeight = contentContainer.scrollHeight;
                contentContainer.style.maxHeight = contentHeight + 'px';
                contentContainer.style.opacity = '1';
                
                // Reset max-height after animation
                setTimeout(() => {
                    if (!config.collapsed) {
                        contentContainer.style.maxHeight = 'none';
                    }
                }, parseFloat(config.animationDuration));
            }
        }
        
        // Update icon
        const icon = demoCollapse.querySelector('.plauna-collapse__icon');
        if (icon) {
            icon.textContent = config.collapsed ? config.iconCollapsed : config.iconExpanded;
            icon.style.transform = 'rotate(' + (config.collapsed ? '0deg' : '180deg') + ')';
        }
        
        toastManager.show('Collapse ' + (config.collapsed ? 'collapsed' : 'expanded'), 'info');
    }
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const toggleButton = document.createElement('button');
    toggleButton.textContent = config.collapsed ? 'Expand' : 'Collapse';
    toggleButton.style.cssText = (
        'background: ' + tokens.get('colors.primary') + ';' +
        'color: ' + tokens.get('colors.text.inverse') + ';' +
        'border: 1px solid ' + tokens.get('colors.primary') + ';' +
        'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
        'padding: ' + tokens.get('spacing.sm') + ' ' + tokens.get('spacing.md') + ';' +
        'font-size: ' + tokens.get('fontSizes.sm') + ';' +
        'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
        'cursor: pointer;' +
        'transition: all 150ms ease;'
    );
    
    toggleButton.addEventListener('click', toggleCollapse);
    
    toggleButton.addEventListener('mouseenter', () => {
        toggleButton.style.background = 'rgba(255, 255, 255, 0.1)';
        toggleButton.style.color = tokens.get('colors.primary');
    });
    
    toggleButton.addEventListener('mouseleave', () => {
        toggleButton.style.background = tokens.get('colors.primary');
        toggleButton.style.color = tokens.get('colors.text.inverse');
    });
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
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
    
    closeButton.addEventListener('click', closeCollapse);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(toggleButton);
    controls.appendChild(closeButton);
    collapseElement.appendChild(controls);
    
    // Helper function for collapse styles
    function getCollapseStyles(config) {
        let styles = (
            'display: block;' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border: ' + getBorderValue(config.variant, config.border, config.borderColor, config.borderWidth) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'md') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'overflow: hidden;' +
            'position: relative;' +
            'transition: all ' + config.animationDuration + ' ' + config.animationEasing + ';' +
            'cursor: pointer;' +
            'outline: none;' +
            'box-sizing: border-box;'
        );
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.md;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.md;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 3px rgba(0, 0, 0, 0.1)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant, border, borderColor, borderWidth) {
        if (border === 'none') {
            return 'none';
        }
        
        const borderColors = {
            light: tokens.get('colors.border.light'),
            medium: tokens.get('colors.border.medium'),
            dark: tokens.get('colors.border.dark')
        };
        
        const color = borderColors[borderColor] || borderColors.medium;
        const width = borderWidth || '1px';
        
        if (border === 'all') {
            return width + ' solid ' + color;
        } else if (border === 'top') {
            return 'border-top: ' + width + ' solid ' + color;
        } else if (border === 'bottom') {
            return 'border-bottom: ' + width + ' solid ' + color;
        } else if (border === 'left') {
            return 'border-left: ' + width + ' solid ' + color;
        } else if (border === 'right') {
            return 'border-right: ' + width + ' solid ' + color;
        }
        
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getCollapseTextColor(variant, background) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            card: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            bordered: tokens.get('colors.text.primary'),
            ghost: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(collapseElement);
    
    // Animate in
    requestAnimationFrame(() => {
        collapseElement.style.opacity = '1';
        collapseElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!collapseElement.contains(e.target)) {
                closeCollapse();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeCollapse();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeCollapse() {
        collapseElement.style.opacity = '0';
        collapseElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (collapseElement.parentNode) {
                collapseElement.parentNode.removeChild(collapseElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} collapse displayed`, 'info');
}

export function createDemoHeaderFooter(type, triggerButton, toastManager) {
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
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const headerFooterConfigs = {
        header: {
            type: 'header',
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            alignment: 'space-between',
            brand: 'YourBrand',
            navigation: [
                { text: 'Home', href: '#home', active: true },
                { text: 'About', href: '#about' },
                { text: 'Services', href: '#services' },
                { text: 'Contact', href: '#contact' }
            ],
            actions: [
                { text: 'Sign In', variant: 'primary' },
                { text: 'Sign Up' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Default Header'
        },
        'header-primary': {
            type: 'header',
            variant: 'primary',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            alignment: 'space-between',
            brand: 'YourBrand',
            navigation: [
                { text: 'Dashboard', href: '#dashboard' },
                { text: 'Analytics', href: '#analytics' },
                { text: 'Reports', href: '#reports' }
            ],
            actions: [
                { text: 'Profile', variant: 'primary' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Primary Header'
        },
        'header-sticky': {
            type: 'header',
            variant: 'sticky',
            size: 'md',
            padding: 'md',
            background: 'primary',
            position: 'sticky',
            alignment: 'space-between',
            brand: 'StickyBrand',
            navigation: [
                { text: 'Products', href: '#products' },
                { text: 'Pricing', href: '#pricing' },
                { text: 'Docs', href: '#docs' }
            ],
            actions: [
                { text: 'Get Started', variant: 'primary' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Sticky Header'
        },
        'header-elevated': {
            type: 'header',
            variant: 'elevated',
            size: 'lg',
            padding: 'xl',
            background: 'primary',
            alignment: 'space-between',
            brand: 'ElevatedBrand',
            navigation: [
                { text: 'Features', href: '#features' },
                { text: 'Solutions', href: '#solutions' },
                { text: 'Resources', href: '#resources' },
                { text: 'Company', href: '#company' }
            ],
            actions: [
                { text: 'Demo', variant: 'primary' },
                { text: 'Contact Sales' }
            ],
            showBrand: true,
            showNavigation: true,
            showActions: true,
            title: 'Elevated Header'
        },
        footer: {
            type: 'footer',
            variant: 'default',
            size: 'md',
            padding: 'lg',
            background: 'primary',
            alignment: 'space-between',
            navigation: [
                { text: 'Privacy', href: '#privacy' },
                { text: 'Terms', href: '#terms' },
                { text: 'Support', href: '#support' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Default Footer'
        },
        'footer-primary': {
            type: 'footer',
            variant: 'primary',
            size: 'lg',
            padding: 'xl',
            background: 'primary',
            alignment: 'space-between',
            navigation: [
                { text: 'About Us', href: '#about' },
                { text: 'Careers', href: '#careers' },
                { text: 'Press', href: '#press' },
                { text: 'Blog', href: '#blog' },
                { text: 'Contact', href: '#contact' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Primary Footer'
        },
        'footer-secondary': {
            type: 'footer',
            variant: 'secondary',
            size: 'md',
            padding: 'lg',
            background: 'secondary',
            alignment: 'space-between',
            navigation: [
                { text: 'Documentation', href: '#docs' },
                { text: 'API', href: '#api' },
                { text: 'Community', href: '#community' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Secondary Footer'
        },
        'footer-outlined': {
            type: 'footer',
            variant: 'outlined',
            size: 'md',
            padding: 'lg',
            background: 'transparent',
            alignment: 'space-between',
            navigation: [
                { text: 'Resources', href: '#resources' },
                { text: 'Tools', href: '#tools' },
                { text: 'Guides', href: '#guides' }
            ],
            copyright: '© 2024 Your Company. All rights reserved.',
            showNavigation: true,
            showCopyright: true,
            title: 'Outlined Footer'
        }
    };
    
    const config = headerFooterConfigs[type] || headerFooterConfigs.header;
    
    // Create header/footer as a simple DOM element for demo
    const headerFooterElement = document.createElement('div');
    headerFooterElement.className = 'plauna-demo-headerfooter';
    headerFooterElement.style.cssText = (
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
        'min-width: 700px;' +
        'max-width: 900px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = `${config.type === 'header' ? 'Header' : 'Footer'} Layout Demo`;
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    headerFooterElement.appendChild(title);
    
    // Create demo header/footer
    const demoHeaderFooter = document.createElement('div');
    demoHeaderFooter.style.cssText = getHeaderFooterStyles(config);
    demoHeaderFooter.setAttribute('role', config.type === 'header' ? 'banner' : 'contentinfo');
    
    // Create main content container
    const main = document.createElement('div');
    main.className = 'plauna-header-footer__main';
    main.style.cssText = (
        'display: ' + (config.display || 'flex') + ';' +
        'flex-direction: ' + (config.flexDirection || 'row') + ';' +
        'justify-content: ' + (config.alignment === 'space-between' ? 'space-between' : config.alignment === 'center' ? 'center' : config.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
        'align-items: ' + (config.alignItems || 'center') + ';' +
        'gap: ' + tokens.get('spacing.lg') + ';' +
        'width: 100%;'
    );
    
    // Add brand if needed
    if (config.showBrand && config.brand) {
        const brandSection = document.createElement('div');
        brandSection.className = 'plauna-header-footer__brand';
        brandSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        const brandElement = document.createElement('div');
        brandElement.className = 'plauna-header-footer__brand-element';
        brandElement.textContent = typeof config.brand === 'string' ? config.brand : config.brand.text || '';
        brandElement.style.cssText = (
            'font-size: ' + tokens.get('fontSizes.lg') + ';' +
            'font-weight: ' + tokens.get('fontWeights.bold') + ';' +
            'color: ' + getHeaderFooterTextColor(config.variant, config.background) + ';' +
            'text-decoration: none;' +
            'line-height: 1.2;' +
            'cursor: pointer;'
        );
        
        brandElement.addEventListener('click', () => {
            toastManager.show('Brand clicked', 'info');
        });
        
        brandSection.appendChild(brandElement);
        main.appendChild(brandSection);
    }
    
    // Add navigation if needed
    if (config.showNavigation && config.navigation.length > 0) {
        const navSection = document.createElement('nav');
        navSection.className = 'plauna-header-footer__navigation';
        navSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.lg') + ';'
        );
        
        config.navigation.forEach((item, index) => {
            const navItem = document.createElement('a');
            navItem.className = 'plauna-header-footer__nav-item';
            navItem.textContent = item.text || '';
            navItem.style.cssText = (
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'color: ' + getHeaderFooterTextColor(config.variant, config.background) + ';' +
                'text-decoration: none;' +
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'transition: all 150ms ease;' +
                'cursor: pointer;'
            );
            
            if (item.active) {
                navItem.style.background = 'rgba(255, 255, 255, 0.1)';
            }
            
            navItem.addEventListener('click', () => {
                toastManager.show(`Navigation: ${item.text}`, 'info');
            });
            
            navItem.addEventListener('mouseenter', () => {
                if (!item.active) {
                    navItem.style.background = 'rgba(255, 255, 255, 0.1)';
                }
            });
            
            navItem.addEventListener('mouseleave', () => {
                if (!item.active) {
                    navItem.style.background = 'transparent';
                }
            });
            
            navSection.appendChild(navItem);
        });
        
        main.appendChild(navSection);
    }
    
    // Add actions if needed
    if (config.showActions && config.actions.length > 0) {
        const actionsSection = document.createElement('div');
        actionsSection.className = 'plauna-header-footer__actions';
        actionsSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'gap: ' + tokens.get('spacing.sm') + ';'
        );
        
        config.actions.forEach((action, index) => {
            const actionButton = document.createElement('button');
            actionButton.className = 'plauna-header-footer__action';
            actionButton.textContent = action.text || 'Action';
            actionButton.style.cssText = (
                'padding: ' + tokens.get('spacing.xs') + ' ' + tokens.get('spacing.sm') + ';' +
                'background: ' + (action.variant === 'primary' ? tokens.get('colors.primary') : 'transparent') + ';' +
                'color: ' + (action.variant === 'primary' ? tokens.get('colors.text.inverse') : getHeaderFooterTextColor(config.variant, config.background)) + ';' +
                'border: 1px solid ' + (action.variant === 'primary' ? tokens.get('colors.primary') : tokens.get('colors.border.medium')) + ';' +
                'border-radius: ' + tokens.get('borderRadius.sm') + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            actionButton.addEventListener('click', () => {
                toastManager.show(`Action: ${action.text}`, 'info');
            });
            
            actionButton.addEventListener('mouseenter', () => {
                if (action.variant === 'primary') {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = tokens.get('colors.primary');
                } else {
                    actionButton.style.background = 'rgba(255, 255, 255, 0.1)';
                    actionButton.style.color = getHeaderFooterTextColor(config.variant, config.background);
                }
            });
            
            actionButton.addEventListener('mouseleave', () => {
                if (action.variant === 'primary') {
                    actionButton.style.background = tokens.get('colors.primary');
                    actionButton.style.color = tokens.get('colors.text.inverse');
                } else {
                    actionButton.style.background = 'transparent';
                    actionButton.style.color = getHeaderFooterTextColor(config.variant, config.background);
                }
            });
            
            actionsSection.appendChild(actionButton);
        });
        
        main.appendChild(actionsSection);
    }
    
    demoHeaderFooter.appendChild(main);
    
    // Add copyright if needed (footer only)
    if (config.type === 'footer' && config.showCopyright && config.copyright) {
        const copyrightSection = document.createElement('div');
        copyrightSection.className = 'plauna-header-footer__copyright';
        copyrightSection.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'font-size: ' + tokens.get('fontSizes.xs') + ';' +
            'color: ' + tokens.get('colors.text.secondary') + ';' +
            'line-height: 1.4;' +
            'margin-top: ' + tokens.get('spacing.md') + ';' +
            'padding-top: ' + tokens.get('spacing.md') + ';' +
            'border-top: 1px solid ' + tokens.get('colors.border.light') + ';'
        );
        copyrightSection.textContent = config.copyright;
        demoHeaderFooter.appendChild(copyrightSection);
    }
    
    headerFooterElement.appendChild(demoHeaderFooter);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
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
    
    closeButton.addEventListener('click', closeHeaderFooter);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    headerFooterElement.appendChild(controls);
    
    // Helper function for header/footer styles
    function getHeaderFooterStyles(config) {
        let styles = (
            'display: ' + (config.display || 'flex') + ';' +
            'flex-direction: ' + (config.flexDirection || 'row') + ';' +
            'justify-content: ' + (config.alignment === 'space-between' ? 'space-between' : config.alignment === 'center' ? 'center' : config.alignment === 'right' ? 'flex-end' : 'flex-start') + ';' +
            'align-items: ' + (config.alignItems || 'center') + ';' +
            'padding: ' + getPaddingValue(config.padding) + ';' +
            'margin: ' + getMarginValue(config.margin || 'none') + ';' +
            'background: ' + getBackgroundColor(config.background, config.variant) + ';' +
            'border: ' + getBorderValue(config.variant, config.border, config.borderColor, config.borderWidth) + ';' +
            'border-radius: ' + getBorderRadiusValue(config.borderRadius || 'none') + ';' +
            'box-shadow: ' + getShadowValue(config.shadow || 'none') + ';' +
            'min-height: ' + (config.type === 'header' ? '56px' : '80px') + ';' +
            'width: 100%;'
        );
        
        return styles;
    }
    
    function getPaddingValue(padding) {
        const paddings = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return paddings[padding] || paddings.lg;
    }
    
    function getMarginValue(margin) {
        const margins = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl')
        };
        return margins[margin] || margins.none;
    }
    
    function getBorderRadiusValue(borderRadius) {
        const radii = {
            none: '0',
            sm: tokens.get('borderRadius.sm'),
            md: tokens.get('borderRadius.md'),
            lg: tokens.get('borderRadius.lg'),
            xl: tokens.get('borderRadius.xl'),
            full: '9999px'
        };
        return radii[borderRadius] || radii.none;
    }
    
    function getShadowValue(shadow) {
        const shadows = {
            none: 'none',
            sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
            lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
            xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)'
        };
        return shadows[shadow] || shadows.none;
    }
    
    function getBorderValue(variant, border, borderColor, borderWidth) {
        if (border === 'none') {
            return 'none';
        }
        
        const borderColors = {
            light: tokens.get('colors.border.light'),
            medium: tokens.get('colors.border.medium'),
            dark: tokens.get('colors.border.dark')
        };
        
        const color = borderColors[borderColor] || borderColors.medium;
        const width = borderWidth || '1px';
        
        if (border === 'all') {
            return width + ' solid ' + color;
        } else if (border === 'top') {
            return 'border-top: ' + width + ' solid ' + color;
        } else if (border === 'bottom') {
            return 'border-bottom: ' + width + ' solid ' + color;
        } else if (border === 'left') {
            return 'border-left: ' + width + ' solid ' + color;
        } else if (border === 'right') {
            return 'border-right: ' + width + ' solid ' + color;
        }
        
        return 'none';
    }
    
    function getBackgroundColor(background, variant) {
        const backgrounds = {
            default: tokens.get('colors.background.primary'),
            primary: tokens.get('colors.primary'),
            secondary: tokens.get('colors.secondary'),
            accent: tokens.get('colors.accent'),
            surface: tokens.get('colors.surface'),
            transparent: 'transparent'
        };
        return backgrounds[background] || backgrounds.default;
    }
    
    function getHeaderFooterTextColor(variant, background) {
        const colors = {
            default: tokens.get('colors.text.primary'),
            primary: tokens.get('colors.text.inverse'),
            secondary: tokens.get('colors.text.inverse'),
            accent: tokens.get('colors.text.inverse'),
            muted: tokens.get('colors.text.primary'),
            outlined: tokens.get('colors.text.primary'),
            elevated: tokens.get('colors.text.primary'),
            sticky: tokens.get('colors.text.primary'),
            fixed: tokens.get('colors.text.primary')
        };
        return colors[variant] || colors.default;
    }
    
    // Add to DOM
    document.body.appendChild(headerFooterElement);
    
    // Animate in
    requestAnimationFrame(() => {
        headerFooterElement.style.opacity = '1';
        headerFooterElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!headerFooterElement.contains(e.target)) {
                closeHeaderFooter();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeHeaderFooter();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeHeaderFooter() {
        headerFooterElement.style.opacity = '0';
        headerFooterElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (headerFooterElement.parentNode) {
                headerFooterElement.parentNode.removeChild(headerFooterElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.variant} ${config.type} displayed`, 'info');
}

export function createDemoGrid(type, triggerButton, toastManager) {
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
                'borderRadius.lg': '12px',
                'borderRadius.xl': '16px',
                'fontSizes.xs': '12px',
                'fontSizes.sm': '14px',
                'fontSizes.md': '16px',
                'fontSizes.lg': '18px',
                'fontSizes.xl': '20px',
                'fontWeights.normal': '400',
                'fontWeights.medium': '500',
                'fontWeights.bold': '700',
                'fontWeights.semibold': '600',
                'colors.background.primary': '#ffffff',
                'colors.background.secondary': '#f8fafc',
                'colors.primary': '#3b82f6',
                'colors.secondary': '#64748b',
                'colors.accent': '#8b5cf6',
                'colors.text.primary': '#1e293b',
                'colors.text.secondary': '#64748b',
                'colors.text.inverse': '#ffffff',
                'colors.border.light': '#e2e8f0',
                'colors.border.medium': '#cbd5e1',
                'colors.border.dark': '#94a3b8',
                'colors.surface': '#f1f5f9'
            };
            return values[paths.join('.')] || path;
        }
    };
    
    const gridConfigs = {
        default: {
            columns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'md',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Auto-Fit Grid'
        },
        'auto-fill': {
            columns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 'lg',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Auto-Fill Grid'
        },
        'fixed-columns': {
            columns: 3,
            gap: 'md',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Fixed Columns Grid'
        },
        'responsive': {
            columns: 1,
            gap: 'md',
            breakpoints: {
                sm: { columns: 2 },
                lg: { columns: 3 },
                xl: { columns: 4 }
            },
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Responsive Grid'
        },
        'masonry': {
            columns: 'auto-fit',
            gap: 'md',
            autoFlow: 'dense',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Masonry Grid'
        },
        'centered': {
            columns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 'lg',
            autoFlow: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            title: 'Centered Grid'
        },
        'template': {
            templateAreas: [
                'header header header',
                'sidebar main main',
                'footer footer footer'
            ],
            columns: '200px 1fr 200px',
            gap: 'md',
            autoFlow: 'row',
            title: 'Template Areas Grid'
        },
        'mixed-sizes': {
            columns: '2fr 1fr 3fr 1fr',
            gap: 'md',
            autoFlow: 'row',
            justifyContent: 'start',
            alignItems: 'start',
            title: 'Mixed Sizes Grid'
        }
    };
    
    const config = gridConfigs[type] || gridConfigs.default;
    
    // Create grid as a simple DOM element for demo
    const gridElement = document.createElement('div');
    gridElement.className = 'plauna-demo-grid';
    gridElement.style.cssText = (
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
        'min-width: 700px;' +
        'max-width: 900px;' +
        'display: flex;' +
        'flex-direction: column;' +
        'gap: 24px;'
    );
    
    // Create title
    const title = document.createElement('div');
    title.textContent = 'Grid Layout Demo';
    title.style.cssText = (
        'font-size: 18px;' +
        'font-weight: ' + tokens.get('fontWeights.semibold') + ';' +
        'color: #e4e4e7;' +
        'text-align: center;' +
        'margin-bottom: 8px;'
    );
    gridElement.appendChild(title);
    
    // Create demo grid
    const demoGrid = document.createElement('div');
    demoGrid.style.cssText = getGridStyles(config);
    demoGrid.setAttribute('role', 'grid');
    
    // Add grid items based on configuration
    const gridItems = generateGridItems(config);
    gridItems.forEach(item => {
        demoGrid.appendChild(item);
    });
    
    gridElement.appendChild(demoGrid);
    
    // Create controls
    const controls = document.createElement('div');
    controls.style.cssText = (
        'display: flex;' +
        'justify-content: center;' +
        'gap: ' + tokens.get('spacing.md') + ';' +
        'padding-top: ' + tokens.get('spacing.lg') + ';' +
        'border-top: 1px solid rgba(99, 116, 141, 0.3);'
    );
    
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.cssText = (
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
    
    closeButton.addEventListener('click', closeGrid);
    
    closeButton.addEventListener('mouseenter', () => {
        closeButton.style.background = 'rgba(255, 255, 255, 0.1)';
        closeButton.style.color = '#e4e4e7';
    });
    
    closeButton.addEventListener('mouseleave', () => {
        closeButton.style.background = 'transparent';
        closeButton.style.color = '#94a3b8';
    });
    
    controls.appendChild(closeButton);
    gridElement.appendChild(controls);
    
    // Helper function to generate grid items
    function generateGridItems(config) {
        const items = [];
        const colors = [tokens.get('colors.primary'), tokens.get('colors.secondary'), tokens.get('colors.accent')];
        const heights = ['60px', '80px', '100px', '120px', '140px'];
        
        // Determine number of items based on grid configuration
        let itemCount = 8;
        if (config.columns === 3) {
            itemCount = 9;
        } else if (config.columns === '2fr 1fr 3fr 1fr') {
            itemCount = 12;
        } else if (config.templateAreas) {
            itemCount = 5; // header, sidebar, main, main, footer
        }
        
        for (let i = 0; i < itemCount; i++) {
            const item = document.createElement('div');
            item.className = 'plauna-grid-item';
            
            // Set grid area for template grid
            if (config.templateAreas) {
                const areas = ['header', 'sidebar', 'main', 'main', 'footer'];
                if (i < areas.length) {
                    item.style.gridArea = areas[i];
                }
            }
            
            item.style.cssText = (
                'background: ' + colors[i % colors.length] + ';' +
                'color: white;' +
                'border-radius: ' + tokens.get('borderRadius.md') + ';' +
                'font-weight: ' + tokens.get('fontWeights.medium') + ';' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: center;' +
                'min-height: ' + heights[i % heights.length] + ';' +
                'font-size: ' + tokens.get('fontSizes.sm') + ';' +
                'cursor: pointer;' +
                'transition: all 150ms ease;'
            );
            
            item.textContent = `Item ${i + 1}`;
            
            item.addEventListener('click', () => {
                toastManager.show(`Grid item ${i + 1} clicked`, 'info');
            });
            
            item.addEventListener('mouseenter', () => {
                item.style.transform = 'scale(1.05)';
                item.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.transform = 'scale(1)';
                item.style.boxShadow = 'none';
            });
            
            items.push(item);
        }
        
        return items;
    }
    
    // Helper function for grid styles
    function getGridStyles(config) {
        let styles = (
            'display: grid;' +
            'gap: ' + getGapValue(config.gap) + ';' +
            'grid-auto-flow: ' + config.autoFlow + ';' +
            'justify-content: ' + config.justifyContent + ';' +
            'align-items: ' + config.alignItems + ';' +
            'width: 100%;' +
            'min-height: 300px;'
        );
        
        if (config.columns) {
            if (typeof config.columns === 'number') {
                styles += 'grid-template-columns: repeat(' + config.columns + ', 1fr);';
            } else if (config.columns.includes('repeat')) {
                styles += 'grid-template-columns: ' + config.columns + ';';
            } else {
                styles += 'grid-template-columns: ' + config.columns + ';';
            }
        }
        
        if (config.rows) {
            if (typeof config.rows === 'number') {
                styles += 'grid-template-rows: repeat(' + config.rows + ', 1fr);';
            } else if (config.rows.includes('repeat')) {
                styles += 'grid-template-rows: ' + config.rows + ';';
            } else {
                styles += 'grid-template-rows: ' + config.rows + ';';
            }
        }
        
        if (config.templateAreas) {
            const areas = Array.isArray(config.templateAreas) 
                ? config.templateAreas.map(area => `"${area}"`).join(' ')
                : config.templateAreas;
            styles += 'grid-template-areas: ' + areas + ';';
        }
        
        return styles;
    }
    
    function getGapValue(gap) {
        const gaps = {
            none: '0',
            xs: tokens.get('spacing.xs'),
            sm: tokens.get('spacing.sm'),
            md: tokens.get('spacing.md'),
            lg: tokens.get('spacing.lg'),
            xl: tokens.get('spacing.xl'),
            xxxl: tokens.get('spacing.xxxl')
        };
        return gaps[gap] || gaps.md;
    }
    
    // Add to DOM
    document.body.appendChild(gridElement);
    
    // Animate in
    requestAnimationFrame(() => {
        gridElement.style.opacity = '1';
        gridElement.style.transform = 'translate(-50%, -50%) scale(1)';
    });
    
    // Close on outside click (with delay to prevent immediate closing)
    setTimeout(() => {
        const outsideClickHandler = (e) => {
            if (!gridElement.contains(e.target)) {
                closeGrid();
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        document.addEventListener('click', outsideClickHandler);
    }, 100);
    
    // Close on escape
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            closeGrid();
            document.removeEventListener('keydown', escapeHandler);
        }
    };
    document.addEventListener('keydown', escapeHandler);
    
    function closeGrid() {
        gridElement.style.opacity = '0';
        gridElement.style.transform = 'translate(-50%, -50%) scale(0.9)';
        setTimeout(() => {
            if (gridElement.parentNode) {
                gridElement.parentNode.removeChild(gridElement);
            }
        }, 200);
    }
    
    toastManager.show(`${config.title} displayed`, 'info');
}
