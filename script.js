/* Site behaviour.

   Four independent blocks, in order:

     1. Nav       — runs on every page.
     2. Register  — runs where the sign-up dialog exists (index.html).
     3. Voucher   — runs where the ticket exists (index.html).
     4. Deck      — runs where [data-section] sections exist (index.html).

   They are separate $(function(){}) blocks on purpose: the deck used to
   early-return before anything else could run, which would have killed
   the nav on every page that isn't the home page. */


/* ===================================================================
   Browser storage

   Shared by the sign-up dialog and the voucher. Every call can throw —
   storage is unavailable in some privacy modes, can be over quota, or
   can be holding something an older version of this page wrote — so a
   failed read has to come back as "nothing saved" rather than take the
   page down with it.
   =================================================================== */

var UTARStore = (function () {
    function pick(kind) {
        try {
            return kind === 'session' ? window.sessionStorage : window.localStorage;
        } catch (e) {
            return null;
        }
    }

    return {
        read: function (kind, key) {
            var s = pick(kind);
            if (!s) {
                return null;
            }
            try {
                return JSON.parse(s.getItem(key));
            } catch (e) {
                return null;
            }
        },

        write: function (kind, key, value) {
            var s = pick(kind);
            if (!s) {
                return;
            }
            try {
                s.setItem(key, JSON.stringify(value));
            } catch (e) {
                /* Quota or a private window — the page still works, it
                   just will not remember anything next time. */
            }
        },

        remove: function (kind, key) {
            var s = pick(kind);
            if (!s) {
                return;
            }
            try {
                s.removeItem(key);
            } catch (e) { }
        }
    };
})();


/* ===================================================================
   1 · Navigation
   =================================================================== */

$(function () {
    var $nav = $('.site-nav');
    if (!$nav.length) {
        return;
    }

    var SOLID_AT = 40;

    function syncNav() {
        $nav.toggleClass('is-solid', $(window).scrollTop() > SOLID_AT);
    }

    /* scroll fires far faster than the screen repaints; coalescing into
       one rAF keeps the handler off the critical path. */
    var queued = false;
    $(window).on('scroll', function () {
        if (queued) {
            return;
        }
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            syncNav();
        });
    });

    // Reloading halfway down a page should not start out transparent.
    syncNav();

    /* Bootstrap locks scrolling with overflow:hidden on <body>, which
       does nothing here — style.css makes <html> the scroll container.
       Without this the page scrolls away behind an open dialog. */
    $(document).on('show.bs.modal', function () {
        $('html').addClass('has-modal');
    });
    $(document).on('hidden.bs.modal', function () {
        $('html').removeClass('has-modal');
    });
});


/* ===================================================================
   2 · Registration dialog + browser storage

   What gets typed is kept as a draft so a half-finished sign-up
   survives leaving the page, and the two storages are used for
   different halves of it on purpose:

     localStorage   — club details. Survives closing the browser.
     sessionStorage — card fields. Wiped the moment the browser closes,
                      which is where anything payment-shaped belongs.

   Nothing is submitted anywhere; this is a coursework demonstration.
   =================================================================== */

$(function () {
    var $form = $('#registerForm');
    if (!$form.length) {
        return;
    }

    var KEYS = {
        DRAFT: 'utar.regDraft',    // localStorage
        PAY: 'utar.payDraft',      // sessionStorage
        MEMBER: 'utar.member'      // localStorage, written once sign-up completes
    };

    var DRAFT_FIELDS = ['fullName', 'email', 'studentId', 'favGame'];
    var PAY_FIELDS = ['cardName', 'cardNumber', 'expiry', 'cvv'];

    var $modal = $('#registerModal');
    var $status = $form.find('.reg-status');
    var $back = $form.find('.reg-back');
    var $next = $form.find('.reg-next');
    var $submit = $form.find('.reg-submit');

    var modal = new bootstrap.Modal($modal[0]);
    var step = 1;

    // ---------------------------------------------------------------
    // Reading and writing the form
    // ---------------------------------------------------------------

    function field(name) {
        return $form.find('[name="' + name + '"]');
    }

    function collect(names) {
        var out = {};
        $.each(names, function (i, name) {
            out[name] = field(name).val() || '';
        });
        return out;
    }

    function fill(names, data) {
        if (!data) {
            return;
        }
        $.each(names, function (i, name) {
            if (typeof data[name] === 'string') {
                field(name).val(data[name]);
            }
        });
    }

    function saveDraft() {
        var details = collect(DRAFT_FIELDS);
        details.plan = $form.find('[name="plan"]:checked').val() || 'casual';
        details.step = step;
        details.savedAt = new Date().toISOString();

        UTARStore.write('local', KEYS.DRAFT, details);

        /* Only once there is actually a card to remember. Writing the
           empty object on step 1 would leave a payment key sitting in
           session storage before the payment step is even reached. */
        var pay = collect(PAY_FIELDS);
        var hasCard = $.grep(PAY_FIELDS, function (name) {
            return pay[name] !== '';
        }).length > 0;

        if (hasCard) {
            UTARStore.write('session', KEYS.PAY, pay);
        } else {
            UTARStore.remove('session', KEYS.PAY);
        }

        flash('<strong>Draft saved</strong> to browser storage');
    }

    function restoreDraft() {
        var details = UTARStore.read('local', KEYS.DRAFT);
        var pay = UTARStore.read('session', KEYS.PAY);

        fill(DRAFT_FIELDS, details);
        fill(PAY_FIELDS, pay);

        if (details && details.plan) {
            $form.find('[name="plan"][value="' + details.plan + '"]').prop('checked', true);
        }
        if (details && details.step === 2) {
            goToStep(2);
        }

        if (details) {
            var when = details.savedAt ? new Date(details.savedAt) : null;
            flash('<strong>Draft restored</strong>' + (when ? ' &mdash; saved ' + when.toLocaleString() : ''), 6000);
        }
    }

    /* Only ever called with strings written above — no field value ever
       reaches it, so .html() cannot be fed markup by the user. */
    var flashTimer = null;
    function flash(message, hold) {
        $status.html(message).addClass('is-visible');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () {
            $status.removeClass('is-visible');
        }, hold || 2500);
    }

    // ---------------------------------------------------------------
    // Steps
    // ---------------------------------------------------------------

    function goToStep(n) {
        step = n;

        $form.find('.reg-step').each(function () {
            this.hidden = $(this).data('step') !== n;
        });
        $modal.find('.reg-steps li').each(function () {
            $(this).toggleClass('is-current', $(this).data('step') === n);
        });

        $back.prop('hidden', n === 1);
        $next.prop('hidden', n === 2);
        $submit.prop('hidden', n !== 2);
    }

    /* Native constraint validation, but scoped to the fieldset on
       screen — reportValidity() on the whole form would try to point at
       the hidden step and give up silently. */
    function stepIsValid(n) {
        var ok = true;
        $form.find('.reg-step[data-step="' + n + '"]').find('input, select').each(function () {
            if (!this.checkValidity()) {
                this.reportValidity();
                ok = false;
                return false;
            }
        });
        return ok;
    }

    $next.on('click', function () {
        if (stepIsValid(1)) {
            goToStep(2);
            saveDraft();
        }
    });

    $back.on('click', function () {
        goToStep(1);
        saveDraft();
    });

    // ---------------------------------------------------------------
    // Saving as it is typed
    // ---------------------------------------------------------------

    var saveTimer = null;
    $form.on('input change', function () {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 300);
    });

    // ---------------------------------------------------------------
    // Completing sign-up
    // ---------------------------------------------------------------

    $form.on('submit', function (e) {
        e.preventDefault();

        // Enter pressed on step 1 reaches here too, since the submit
        // button being hidden does not stop the form submitting.
        if (step === 1) {
            $next.trigger('click');
            return;
        }
        if (!stepIsValid(2)) {
            return;
        }

        // A keystroke in the last 300ms still has a save pending, which
        // would put the draft back moments after we clear it.
        clearTimeout(saveTimer);

        var name = field('fullName').val() || 'member';
        var plan = $form.find('[name="plan"]:checked').val() || 'casual';

        UTARStore.write('local', KEYS.MEMBER, {
            name: name,
            plan: plan,
            joinedAt: new Date().toISOString()
        });

        // The draft has served its purpose, and the card details in
        // particular should not outlive the form by a single second.
        UTARStore.remove('local', KEYS.DRAFT);
        UTARStore.remove('session', KEYS.PAY);

        showDone(name, plan);
        applyMemberGreeting();
    });

    /* .text() rather than .html() throughout: this is the one place a
       typed value gets written back into the page. */
    function showDone(name, plan) {
        var $done = $('<div class="reg-done">')
            .append($('<h3 class="reg-done-title">').text("YOU'RE IN, " + name.toUpperCase()))
            .append($('<p class="reg-done-text">').text(
                'Your ' + plan + ' membership is set up. Your saved draft has been cleared from ' +
                'browser storage, and the card details were only ever held for this session.'
            ));

        $modal.find('.modal-body').empty().append($done);
    }

    // ---------------------------------------------------------------
    // The hero greeting, for anyone who has already signed up
    // ---------------------------------------------------------------

    function applyMemberGreeting() {
        var member = UTARStore.read('local', KEYS.MEMBER);
        var $hero = $('.hero-text');
        if (!member || !member.name || !$hero.length) {
            return;
        }

        $hero.empty()
            .append(document.createTextNode('WELCOME BACK, '))
            .append($('<span class="text-highlight">').text(member.name.toUpperCase()));
    }

    // ---------------------------------------------------------------
    // Opening it
    // ---------------------------------------------------------------

    function open(plan) {
        if (plan) {
            $form.find('[name="plan"][value="' + plan + '"]').prop('checked', true);
        }
        modal.show();
    }

    function planFromHash(hash) {
        if (hash === '#register-casual') {
            return 'casual';
        }
        if (hash === '#register-competitive') {
            return 'competitive';
        }
        return '';
    }

    $(document).on('click', 'a[href^="#register"], .welcome-section-button', function (e) {
        e.preventDefault();
        open(planFromHash($(this).attr('href') || ''));
    });

    // Before the hash is read, so a plan picked on membership.html wins
    // over whatever plan the saved draft happens to hold.
    restoreDraft();
    applyMemberGreeting();

    /* Arriving from a membership.html CTA. The hash is stripped once
       used so a later refresh does not force the dialog open again. */
    var hash = window.location.hash;
    if (hash.indexOf('#register') === 0) {
        open(planFromHash(hash));
        if (window.history.replaceState) {
            window.history.replaceState(null, '', window.location.pathname);
        }
    }
});


/* ===================================================================
   3 · Voucher  ·  index.html

   Clicking the ticket goes to the membership page as a plain link, and
   on the way out notes in localStorage that the offer was claimed. Come
   back later and the ticket is stamped.
   =================================================================== */

$(function () {
    var $ticket = $('.voucher-ticket');
    if (!$ticket.length) {
        return;
    }

    var KEY = 'utar.voucher';
    var $stamp = $('.voucher-stamp');
    var $claimed = $('.voucher-claimed');
    var $cta = $('.voucher-cta');

    function showClaim() {
        var voucher = UTARStore.read('local', KEY);
        if (!voucher || !voucher.claimed) {
            return;
        }

        $stamp.prop('hidden', false);

        // "CLAIM VOUCHER" would be asking for something they already have.
        $cta.text('VIEW MEMBERSHIP →');

        var when = voucher.at ? new Date(voucher.at) : null;
        $claimed
            .text('Claimed' + (when ? ' on ' + when.toLocaleDateString() : '') + ' — this discount is already yours.')
            .prop('hidden', false);
    }

    /* No preventDefault: a synchronous localStorage write finishes long
       before the browser leaves the page, so the link can just navigate. */
    $ticket.add('.voucher-cta').on('click', function () {
        UTARStore.write('local', KEY, {
            claimed: true,
            at: new Date().toISOString()
        });
    });

    showClaim();
});


/* ===================================================================
   4 · Section deck  ·  index.html

   CSS scroll-snap is still declared in style.css and is what runs if
   this file never loads. When it does load, jQuery takes over the
   motion: the browser's snap engine and an animated scrollTop fight
   over the same property, so snapping is suspended for the duration of
   each animation and restored afterwards.
   =================================================================== */

$(function () {
    var $sections = $('[data-section]');
    if (!$sections.length) {
        return;
    }

    var $root = $('html');
    var $scroller = $('html, body'); // Which one scrolls varies by browser; animate both.
    var $dotNav = $('.dot-nav');

    var DURATION = 750;
    var current = 0;
    var animating = false;

    /* jQuery core only ships "swing" and "linear". This is the ease the
       whole page uses: slow at both ends, quick through the middle. */
    $.easing.esportEase = function (x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    };

    // The dialog scrolls and takes arrow keys on its own terms; the
    // deck behind it must sit still while it is up.
    function modalIsOpen() {
        return $('.modal.show').length > 0;
    }

    // ---------------------------------------------------------------
    // Build the dots
    // ---------------------------------------------------------------

    $sections.each(function (i) {
        $('<button>', {
            type: 'button',
            'class': 'dot',
            'data-index': i,
            'aria-label': 'Go to ' + $(this).data('section'),
            html: '<span class="dot-label">' + $(this).data('section') + '</span>'
        }).appendTo($dotNav);
    });

    var $dots = $dotNav.find('.dot');

    // ---------------------------------------------------------------
    // Scrolling
    // ---------------------------------------------------------------

    function goTo(index) {
        index = Math.max(0, Math.min(index, $sections.length - 1));
        if (animating || index === current) {
            return;
        }

        animating = true;
        setActive(index);

        // Snapping off for the duration, or the browser yanks the
        // viewport back to a snap point on every animation frame.
        $root.addClass('is-scrolling');

        $scroller.stop(true).animate(
            { scrollTop: $sections.eq(index).offset().top },
            {
                duration: DURATION,
                easing: 'esportEase',
                complete: function () {
                    /* animate() runs on html AND body, so complete fires
                       twice; the flag is cleared on the first one. Also
                       let the scroll settle a frame before re-arming
                       snap, otherwise it can re-snap to the old section. */
                    if (!animating) {
                        return;
                    }
                    animating = false;
                    setTimeout(function () {
                        $root.removeClass('is-scrolling');
                    }, 50);
                }
            }
        );
    }

    function setActive(index) {
        current = index;
        $dots.removeClass('active').eq(index).addClass('active');

        // White dots vanish on the one light section, so flip them.
        var isLight = $sections.eq(index).data('nav-theme') === 'light';
        $dotNav.toggleClass('on-light', isLight);
    }

    $dots.on('click', function () {
        goTo($(this).data('index'));
    });

    // ---------------------------------------------------------------
    // Scroll spy — keeps the dots honest when scrolling by hand
    // ---------------------------------------------------------------

    function syncFromScroll() {
        if (animating) {
            return;
        }

        var middle = $(window).scrollTop() + $(window).height() / 2;
        var found = 0;

        $sections.each(function (i) {
            var top = $(this).offset().top;
            if (middle >= top) {
                found = i;
            }
        });

        if (found !== current) {
            setActive(found);
        }
    }

    /* scroll fires far faster than the screen repaints; coalescing into
       one rAF keeps the handler off the critical path. */
    var queued = false;
    $(window).on('scroll resize', function () {
        if (queued) {
            return;
        }
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            syncFromScroll();
        });
    });

    // ---------------------------------------------------------------
    // Wheel + keyboard, desktop only
    // ---------------------------------------------------------------

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    var desktop = window.matchMedia('(min-width: 768px)');

    /* Not $(window).on('wheel') — Chrome forces wheel listeners on
       window/document/body to be passive, and preventDefault() is a
       no-op (plus a console warning) inside a passive listener. The
       only way to keep the default scroll suppressed is to register it
       natively with passive:false.

       Touch scrolling is left entirely alone — hijacking it breaks
       momentum and fights the browser's own overscroll behaviour. */
    window.addEventListener('wheel', function (e) {
        if (!desktop.matches || reduceMotion.matches || modalIsOpen()) {
            return;
        }

        var delta = e.deltaY;
        if (Math.abs(delta) < 4) {
            return;
        }

        /* A section taller than the viewport (small laptops, three
           stacked cards) has to scroll through internally before we
           hand over to the next one. */
        var $section = $sections.eq(current);
        var top = $section.offset().top;
        var bottom = top + $section.outerHeight();
        var viewTop = $(window).scrollTop();
        var viewBottom = viewTop + $(window).height();

        if (delta > 0 && viewBottom < bottom - 2) {
            return;
        }
        if (delta < 0 && viewTop > top + 2) {
            return;
        }

        e.preventDefault();
        goTo(current + (delta > 0 ? 1 : -1));
    }, { passive: false });

    $(document).on('keydown', function (e) {
        // Typing in a field must keep its own arrow/page behaviour.
        if ($(e.target).is('input, textarea, select') || e.target.isContentEditable) {
            return;
        }
        if (modalIsOpen()) {
            return;
        }

        var keys = { PageDown: 1, PageUp: -1, ArrowDown: 1, ArrowUp: -1 };
        if (e.key in keys) {
            e.preventDefault();
            goTo(current + keys[e.key]);
        } else if (e.key === 'Home') {
            e.preventDefault();
            goTo(0);
        } else if (e.key === 'End') {
            e.preventDefault();
            goTo($sections.length - 1);
        }
    });

    // ---------------------------------------------------------------

    syncFromScroll();
    setActive(current);
});
