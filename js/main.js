/* ========================================
   CLOUD RESUME — Main JavaScript
   Visitor counter + animations
   ======================================== */

// ---- Configuration ----
// Update this URL after deploying your Azure Function
const API_BASE_URL = 'https://cunyuslabs-api.azurewebsites.net/api';

// ---- Visitor Counter ----
async function updateVisitorCount() {
    const counterEl = document.getElementById('visitor-count');
    if (!counterEl) return;

    try {
        const response = await fetch(`${API_BASE_URL}/counter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        animateCounter(counterEl, data.count);
    } catch (err) {
        console.warn('Visitor counter unavailable:', err.message);
        counterEl.textContent = '—';
    }
}

function animateCounter(element, target) {
    const duration = 1500;
    const start = performance.now();
    const from = 0;

    function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(from + (target - from) * eased);
        element.textContent = current.toLocaleString();

        if (progress < 1) {
            requestAnimationFrame(tick);
        }
    }

    requestAnimationFrame(tick);
}

// ---- Scroll Reveal ----
function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Stagger animation for siblings
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, index * 80);
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    reveals.forEach(el => observer.observe(el));
}

// ---- Mobile Navigation ----
function initMobileNav() {
    const toggle = document.getElementById('nav-toggle');
    const links = document.querySelector('.nav__links');

    if (!toggle || !links) return;

    toggle.addEventListener('click', () => {
        links.classList.toggle('open');
        toggle.classList.toggle('active');
    });

    // Close on link click
    links.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            links.classList.remove('open');
            toggle.classList.remove('active');
        });
    });
}

// ---- Active Nav Highlight ----
function initActiveNav() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav__links a');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                navLinks.forEach(link => {
                    link.style.color = '';
                    link.style.background = '';
                    if (link.getAttribute('href') === `#${id}`) {
                        link.style.color = 'var(--text-primary)';
                        link.style.background = 'var(--gradient-subtle)';
                    }
                });
            }
        });
    }, { threshold: 0.3 });

    sections.forEach(section => observer.observe(section));
}

// ---- Initialize ----
document.addEventListener('DOMContentLoaded', () => {
    initScrollReveal();
    initMobileNav();
    initActiveNav();
    updateVisitorCount();
});
