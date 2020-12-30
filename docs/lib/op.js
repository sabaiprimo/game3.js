
(function(l, r) { if (l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (window.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(window.document);
var app = (function () {
    'use strict';

    function noop() { }
    const identity = x => x;
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }
    function get_store_value(store) {
        let value;
        subscribe(store, _ => value = _)();
        return value;
    }
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }

    const is_client = typeof window !== 'undefined';
    let now = is_client
        ? () => window.performance.now()
        : () => Date.now();
    let raf = is_client ? cb => requestAnimationFrame(cb) : noop;

    const tasks = new Set();
    function run_tasks(now) {
        tasks.forEach(task => {
            if (!task.c(now)) {
                tasks.delete(task);
                task.f();
            }
        });
        if (tasks.size !== 0)
            raf(run_tasks);
    }
    /**
     * Creates a new task that runs on each raf frame
     * until it returns a falsy value or is aborted
     */
    function loop(callback) {
        let task;
        if (tasks.size === 0)
            raf(run_tasks);
        return {
            promise: new Promise(fulfill => {
                tasks.add(task = { c: callback, f: fulfill });
            }),
            abort() {
                tasks.delete(task);
            }
        };
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    const active_docs = new Set();
    let active = 0;
    // https://github.com/darkskyapp/string-hash/blob/master/index.js
    function hash(str) {
        let hash = 5381;
        let i = str.length;
        while (i--)
            hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
        return hash >>> 0;
    }
    function create_rule(node, a, b, duration, delay, ease, fn, uid = 0) {
        const step = 16.666 / duration;
        let keyframes = '{\n';
        for (let p = 0; p <= 1; p += step) {
            const t = a + (b - a) * ease(p);
            keyframes += p * 100 + `%{${fn(t, 1 - t)}}\n`;
        }
        const rule = keyframes + `100% {${fn(b, 1 - b)}}\n}`;
        const name = `__svelte_${hash(rule)}_${uid}`;
        const doc = node.ownerDocument;
        active_docs.add(doc);
        const stylesheet = doc.__svelte_stylesheet || (doc.__svelte_stylesheet = doc.head.appendChild(element('style')).sheet);
        const current_rules = doc.__svelte_rules || (doc.__svelte_rules = {});
        if (!current_rules[name]) {
            current_rules[name] = true;
            stylesheet.insertRule(`@keyframes ${name} ${rule}`, stylesheet.cssRules.length);
        }
        const animation = node.style.animation || '';
        node.style.animation = `${animation ? `${animation}, ` : ''}${name} ${duration}ms linear ${delay}ms 1 both`;
        active += 1;
        return name;
    }
    function delete_rule(node, name) {
        const previous = (node.style.animation || '').split(', ');
        const next = previous.filter(name
            ? anim => anim.indexOf(name) < 0 // remove specific animation
            : anim => anim.indexOf('__svelte') === -1 // remove all Svelte animations
        );
        const deleted = previous.length - next.length;
        if (deleted) {
            node.style.animation = next.join(', ');
            active -= deleted;
            if (!active)
                clear_rules();
        }
    }
    function clear_rules() {
        raf(() => {
            if (active)
                return;
            active_docs.forEach(doc => {
                const stylesheet = doc.__svelte_stylesheet;
                let i = stylesheet.cssRules.length;
                while (i--)
                    stylesheet.deleteRule(i);
                doc.__svelte_rules = {};
            });
            active_docs.clear();
        });
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }

    let promise;
    function wait() {
        if (!promise) {
            promise = Promise.resolve();
            promise.then(() => {
                promise = null;
            });
        }
        return promise;
    }
    function dispatch(node, direction, kind) {
        node.dispatchEvent(custom_event(`${direction ? 'intro' : 'outro'}${kind}`));
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    const null_transition = { duration: 0 };
    function create_bidirectional_transition(node, fn, params, intro) {
        let config = fn(node, params);
        let t = intro ? 0 : 1;
        let running_program = null;
        let pending_program = null;
        let animation_name = null;
        function clear_animation() {
            if (animation_name)
                delete_rule(node, animation_name);
        }
        function init(program, duration) {
            const d = program.b - t;
            duration *= Math.abs(d);
            return {
                a: t,
                b: program.b,
                d,
                duration,
                start: program.start,
                end: program.start + duration,
                group: program.group
            };
        }
        function go(b) {
            const { delay = 0, duration = 300, easing = identity, tick = noop, css } = config || null_transition;
            const program = {
                start: now() + delay,
                b
            };
            if (!b) {
                // @ts-ignore todo: improve typings
                program.group = outros;
                outros.r += 1;
            }
            if (running_program || pending_program) {
                pending_program = program;
            }
            else {
                // if this is an intro, and there's a delay, we need to do
                // an initial tick and/or apply CSS animation immediately
                if (css) {
                    clear_animation();
                    animation_name = create_rule(node, t, b, duration, delay, easing, css);
                }
                if (b)
                    tick(0, 1);
                running_program = init(program, duration);
                add_render_callback(() => dispatch(node, b, 'start'));
                loop(now => {
                    if (pending_program && now > pending_program.start) {
                        running_program = init(pending_program, duration);
                        pending_program = null;
                        dispatch(node, running_program.b, 'start');
                        if (css) {
                            clear_animation();
                            animation_name = create_rule(node, t, running_program.b, running_program.duration, 0, easing, config.css);
                        }
                    }
                    if (running_program) {
                        if (now >= running_program.end) {
                            tick(t = running_program.b, 1 - t);
                            dispatch(node, running_program.b, 'end');
                            if (!pending_program) {
                                // we're done
                                if (running_program.b) {
                                    // intro — we can tidy up immediately
                                    clear_animation();
                                }
                                else {
                                    // outro — needs to be coordinated
                                    if (!--running_program.group.r)
                                        run_all(running_program.group.c);
                                }
                            }
                            running_program = null;
                        }
                        else if (now >= running_program.start) {
                            const p = now - running_program.start;
                            t = running_program.a + running_program.d * easing(p / running_program.duration);
                            tick(t, 1 - t);
                        }
                    }
                    return !!(running_program || pending_program);
                });
            }
        }
        return {
            run(b) {
                if (is_function(config)) {
                    wait().then(() => {
                        // @ts-ignore
                        config = config();
                        go(b);
                    });
                }
                else {
                    go(b);
                }
            },
            end() {
                clear_animation();
                running_program = pending_program = null;
            }
        };
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src\TailwindCss.svelte generated by Svelte v3.31.0 */

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-1k5bkhw-style";
    	append(document.head, style);
    }

    class TailwindCss extends SvelteComponent {
    	constructor(options) {
    		super();
    		if (!document.getElementById("svelte-1k5bkhw-style")) add_css();
    		init(this, options, null, null, safe_not_equal, {});
    	}
    }

    const subscriber_queue = [];
    /**
     * Creates a `Readable` store that allows reading by subscription.
     * @param value initial value
     * @param {StartStopNotifier}start start and stop notifications for subscriptions
     */
    function readable(value, start) {
        return {
            subscribe: writable(value, start).subscribe
        };
    }
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = [];
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (let i = 0; i < subscribers.length; i += 1) {
                        const s = subscribers[i];
                        s[1]();
                        subscriber_queue.push(s, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.push(subscriber);
            if (subscribers.length === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                const index = subscribers.indexOf(subscriber);
                if (index !== -1) {
                    subscribers.splice(index, 1);
                }
                if (subscribers.length === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const SDK_STATES = {
        NOT_CONNECTED: "not connected",
        CONNECTING: "connecting",
        CONNECTED: "connected"
    };

    function createSdk() {
        const { subscribe, set } = writable({
            state: SDK_STATES.NOT_CONNECTED
        });

        return {
            subscribe,
            connect: () => {
                console.log(get_store_value(apiKey));
                set(SDK_STATES.CONNECTING);
            }

        }
    }

    const apiKey = writable("");
    const opSdk = createSdk();

    const url = readable(window.location.href);

    function cubicOut(t) {
        const f = t - 1.0;
        return f * f * f + 1.0;
    }

    function fade(node, { delay = 0, duration = 400, easing = identity }) {
        const o = +getComputedStyle(node).opacity;
        return {
            delay,
            duration,
            easing,
            css: t => `opacity: ${t * o}`
        };
    }
    function fly(node, { delay = 0, duration = 400, easing = cubicOut, x = 0, y = 0, opacity = 0 }) {
        const style = getComputedStyle(node);
        const target_opacity = +style.opacity;
        const transform = style.transform === 'none' ? '' : style.transform;
        const od = target_opacity * (1 - opacity);
        return {
            delay,
            duration,
            easing,
            css: (t, u) => `
			transform: ${transform} translate(${(1 - t) * x}px, ${(1 - t) * y}px);
			opacity: ${target_opacity - (od * u)}`
        };
    }

    var img = "data:image/png;base64,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";

    /* src\components\SdkDrawer.svelte generated by Svelte v3.31.0 */

    function create_if_block(ctx) {
    	let div3;
    	let div0;
    	let div0_transition;
    	let t0;
    	let aside;
    	let span0;
    	let img$1;
    	let img_src_value;
    	let t1;
    	let span3;
    	let t4;
    	let span6;
    	let t7;
    	let span9;
    	let t10;
    	let span12;
    	let t13;
    	let span15;
    	let t16;
    	let div2;
    	let span18;
    	let span16;
    	let t17;
    	let span17;
    	let t18;
    	let t19;
    	let div1;
    	let aside_transition;
    	let current;
    	let mounted;
    	let dispose;
    	let if_block = /*$opSdk*/ ctx[2].state == SDK_STATES.NOT_CONNECTED && create_if_block_1(ctx);

    	return {
    		c() {
    			div3 = element("div");
    			div0 = element("div");
    			t0 = space();
    			aside = element("aside");
    			span0 = element("span");
    			img$1 = element("img");
    			t1 = space();
    			span3 = element("span");

    			span3.innerHTML = `<span class="mr-2"><svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="w-6 h-6"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg></span> 
      <span>Home</span>`;

    			t4 = space();
    			span6 = element("span");

    			span6.innerHTML = `<span class="mr-2"><svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="w-6 h-6"><path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></span> 
      <span>Trending Globally</span>`;

    			t7 = space();
    			span9 = element("span");

    			span9.innerHTML = `<span class="mr-2"><svg fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" stroke="currentColor" viewBox="0 0 24 24" class="w-6 h-6"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg></span> 
      <span>Wishlist</span>`;

    			t10 = space();
    			span12 = element("span");

    			span12.innerHTML = `<span class="mr-2"><svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="w-6 h-6"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></span> 
      <span>About</span>`;

    			t13 = space();
    			span15 = element("span");

    			span15.innerHTML = `<span class="mr-2"><svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="w-6 h-6"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg></span> 
      <span>Contact</span>`;

    			t16 = space();
    			div2 = element("div");
    			span18 = element("span");
    			span16 = element("span");
    			span16.innerHTML = `<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="w-6 h-6"><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
    			t17 = space();
    			span17 = element("span");
    			t18 = text(/*$url*/ ctx[1]);
    			t19 = space();
    			div1 = element("div");
    			if (if_block) if_block.c();
    			attr(div0, "class", "modal-overlay absolute w-full h-full bg-gray-900 opacity-50");
    			if (img$1.src !== (img_src_value = img)) attr(img$1, "src", img_src_value);
    			attr(img$1, "alt", "Logo");
    			attr(img$1, "class", "h-auto w-16 mx-auto");
    			attr(span0, "class", "flex w-full items-center p-4 border-b");
    			attr(span3, "class", "flex items-center p-4 hover:bg-indigo-500 hover:text-white ");
    			attr(span6, "class", "flex items-center p-4 hover:bg-indigo-500 hover:text-white ");
    			attr(span9, "class", "flex items-center p-4 hover:bg-indigo-500 hover:text-white ");
    			attr(span12, "class", "flex items-center p-4 hover:bg-indigo-500 hover:text-white ");
    			attr(span15, "class", "flex items-center p-4 hover:bg-indigo-500 hover:text-white ");
    			attr(span16, "class", "mr-2");
    			attr(span18, "class", "flex items-center p-4 hover:bg-indigo-500 hover:text-white ");
    			attr(div1, "class", "flex items-center p-4 bg-blue-500 w-full");
    			attr(div2, "class", "fixed bottom-0 w-full");
    			attr(aside, "class", "transform top-0 left-0 w-64 bg-white fixed h-full overflow-auto ease-in-out duration-300 z-30");
    			attr(div3, "class", "modal fixed w-full h-full top-0 left-0 flex items-center justify-center");
    		},
    		m(target, anchor) {
    			insert(target, div3, anchor);
    			append(div3, div0);
    			append(div3, t0);
    			append(div3, aside);
    			append(aside, span0);
    			append(span0, img$1);
    			append(aside, t1);
    			append(aside, span3);
    			append(aside, t4);
    			append(aside, span6);
    			append(aside, t7);
    			append(aside, span9);
    			append(aside, t10);
    			append(aside, span12);
    			append(aside, t13);
    			append(aside, span15);
    			append(aside, t16);
    			append(aside, div2);
    			append(div2, span18);
    			append(span18, span16);
    			append(span18, t17);
    			append(span18, span17);
    			append(span17, t18);
    			append(div2, t19);
    			append(div2, div1);
    			if (if_block) if_block.m(div1, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen(div0, "click", /*click_handler_1*/ ctx[5]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (!current || dirty & /*$url*/ 2) set_data(t18, /*$url*/ ctx[1]);

    			if (/*$opSdk*/ ctx[2].state == SDK_STATES.NOT_CONNECTED) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block_1(ctx);
    					if_block.c();
    					if_block.m(div1, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i(local) {
    			if (current) return;

    			add_render_callback(() => {
    				if (!div0_transition) div0_transition = create_bidirectional_transition(div0, fade, { duration: 100 }, true);
    				div0_transition.run(1);
    			});

    			add_render_callback(() => {
    				if (!aside_transition) aside_transition = create_bidirectional_transition(aside, fly, { duration: 400, x: -100 }, true);
    				aside_transition.run(1);
    			});

    			current = true;
    		},
    		o(local) {
    			if (!div0_transition) div0_transition = create_bidirectional_transition(div0, fade, { duration: 100 }, false);
    			div0_transition.run(0);
    			if (!aside_transition) aside_transition = create_bidirectional_transition(aside, fly, { duration: 400, x: -100 }, false);
    			aside_transition.run(0);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div3);
    			if (detaching && div0_transition) div0_transition.end();
    			if (if_block) if_block.d();
    			if (detaching && aside_transition) aside_transition.end();
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (148:8) {#if $opSdk.state == SDK_STATES.NOT_CONNECTED}
    function create_if_block_1(ctx) {
    	let input;
    	let t;
    	let button;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			input = element("input");
    			t = space();
    			button = element("button");
    			button.innerHTML = `<span><svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" class="w-6 h-6"><path d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></span>`;
    			attr(input, "class", "mr-2 py-2 px-1 bg-white text-gray-700 placeholder-gray-500 shadow-md rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent");
    			attr(input, "placeholder", "API key");
    			attr(button, "class", "bg-purple-600 text-white text-base font-semibold py-2 px-2 rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-purple-200");
    		},
    		m(target, anchor) {
    			insert(target, input, anchor);
    			set_input_value(input, /*$apiKey*/ ctx[3]);
    			insert(target, t, anchor);
    			insert(target, button, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(input, "input", /*input_input_handler*/ ctx[6]),
    					listen(button, "click", opSdk.connect)
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*$apiKey*/ 8 && input.value !== /*$apiKey*/ ctx[3]) {
    				set_input_value(input, /*$apiKey*/ ctx[3]);
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(input);
    			if (detaching) detach(t);
    			if (detaching) detach(button);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let button;
    	let img$1;
    	let img_src_value;
    	let t;
    	let if_block_anchor;
    	let current;
    	let mounted;
    	let dispose;
    	let if_block = /*visible*/ ctx[0] && create_if_block(ctx);

    	return {
    		c() {
    			button = element("button");
    			img$1 = element("img");
    			t = space();
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    			attr(img$1, "class", "w-10 h-10 fill-current");
    			attr(img$1, "alt", "g3js logo");
    			if (img$1.src !== (img_src_value = img)) attr(img$1, "src", img_src_value);
    			attr(button, "class", "m-3 fixed top-0 left-0 inline-flex items-center justify-center w-12 h-12 mr-2 transition-colors duration-300 bg-indigo-700 rounded-full hover:bg-indigo-900");
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);
    			append(button, img$1);
    			insert(target, t, anchor);
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[4]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (/*visible*/ ctx[0]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);

    					if (dirty & /*visible*/ 1) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(button);
    			if (detaching) detach(t);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let $url;
    	let $opSdk;
    	let $apiKey;
    	component_subscribe($$self, url, $$value => $$invalidate(1, $url = $$value));
    	component_subscribe($$self, opSdk, $$value => $$invalidate(2, $opSdk = $$value));
    	component_subscribe($$self, apiKey, $$value => $$invalidate(3, $apiKey = $$value));
    	let visible = false;
    	const click_handler = () => $$invalidate(0, visible = !visible);
    	const click_handler_1 = () => $$invalidate(0, visible = !visible);

    	function input_input_handler() {
    		$apiKey = this.value;
    		apiKey.set($apiKey);
    	}

    	return [
    		visible,
    		$url,
    		$opSdk,
    		$apiKey,
    		click_handler,
    		click_handler_1,
    		input_input_handler
    	];
    }

    class SdkDrawer extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    /* src\Op.svelte generated by Svelte v3.31.0 */

    function create_fragment$1(ctx) {
    	let tailwindcss;
    	let t;
    	let sdkdrawer;
    	let current;
    	tailwindcss = new TailwindCss({});
    	sdkdrawer = new SdkDrawer({});

    	return {
    		c() {
    			create_component(tailwindcss.$$.fragment);
    			t = space();
    			create_component(sdkdrawer.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(tailwindcss, target, anchor);
    			insert(target, t, anchor);
    			mount_component(sdkdrawer, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(tailwindcss.$$.fragment, local);
    			transition_in(sdkdrawer.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(tailwindcss.$$.fragment, local);
    			transition_out(sdkdrawer.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(tailwindcss, detaching);
    			if (detaching) detach(t);
    			destroy_component(sdkdrawer, detaching);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let $url;
    	component_subscribe($$self, url, $$value => $$invalidate(1, $url = $$value));

    	function props() {
    		return { url: $url };
    	}

    	return [props];
    }

    class Op extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { props: 0 });
    	}

    	get props() {
    		return this.$$.ctx[0];
    	}
    }

    const op = new Op({
    	target: document.body,
    	props: {
    		name: 'world'
    	}
    });

    // attach to window
    window.op = op;

    return op;

}());
//# sourceMappingURL=op.js.map