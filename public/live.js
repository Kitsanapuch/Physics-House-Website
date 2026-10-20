/* Physics House workspace: account and business data come from the server. */
(() => {
  'use strict';

  const TZ = 'Asia/Bangkok';
  const roleNames = { student: 'นักเรียน', teacher: 'ครูผู้สอน', admin: 'ผู้ดูแล' };
  const subjectNames = { science: 'วิทยาศาสตร์', math: 'คณิตศาสตร์', english: 'ภาษาอังกฤษ', physics: 'ฟิสิกส์', chemistry: 'เคมี', biology: 'ชีวะ' };
  const courseSubjects = { middle: [['science', 'วิทยาศาสตร์'], ['math', 'คณิตศาสตร์'], ['english', 'ภาษาอังกฤษ']], high: [['physics', 'ฟิสิกส์'], ['chemistry', 'เคมี'], ['biology', 'ชีวะ'], ['math', 'คณิตศาสตร์'], ['english', 'ภาษาอังกฤษ']] };
  const levelNames = { middle: 'มัธยมต้น', high: 'มัธยมปลาย' };
  const statusNames = {
    unpaid: 'ยังไม่ชำระ', partial: 'ชำระบางส่วน', paid: 'ชำระแล้ว', void: 'ยกเลิก',
    pending: 'รอตรวจสอบ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ',
    submitted: 'รอตรวจเวลาสอน', payroll_locked: 'ปิดงวดแล้ว', finalized: 'อนุมัติงวดแล้ว',
    draft: 'ร่าง', scheduled: 'ตามตาราง', cancelled: 'ยกเลิก', confirmed: 'ยืนยันแล้ว',
    pending_confirmation: 'รอยืนยันอัตรา', active: 'กำลังเรียน'
  };
  const $ = (id) => document.getElementById(id);
  const state = { me: null, csrf: '', data: null, courses: [], academic: null, classes: [] };
  const thaiMoney = (satang) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(Number(satang || 0) / 100);
  const thaiDate = (date) => {
    if (!date) return '—';
    const parsed = typeof date === 'number' ? new Date(date * 1000) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00+07:00` : date);
    return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'medium' }).format(parsed);
  };
  const thaiDateTime = (epoch) => {
    if (!epoch) return '—';
    const parsed = new Date(epoch * 1000);
    return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('th-TH', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  };
  const bangkokToday = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const hours = (minutes) => `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(Number(minutes || 0) / 60)} ชม.`;
  const status = (value) => statusNames[value] || value || '—';
  const validId = (value) => {
    if (!/^[0-9a-f]{32}$/.test(String(value))) throw new Error('รหัสรายการไม่ถูกต้อง');
    return value;
  };
  const toSatang = (value, allowNegative = false) => {
    const str = String(value).trim();
    if (!(allowNegative ? /^-?\d{1,9}(?:\.\d{1,2})?$/ : /^\d{1,9}(?:\.\d{1,2})?$/).test(str)) throw new Error('กรุณากรอกจำนวนเงินเป็นบาท ไม่เกิน 2 ตำแหน่งทศนิยม');
    const negative = str.startsWith('-');
    const [baht, fraction = ''] = (negative ? str.slice(1) : str).split('.');
    const amount = Number(baht) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(amount) || amount === 0) throw new Error('จำนวนเงินไม่ถูกต้อง');
    return negative ? -amount : amount;
  };
  const bangkokInput = (epoch) => {
    if (!epoch) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(epoch * 1000)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  const bangkokISO = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('กรุณาระบุวันและเวลา');
    return `${value}:00+07:00`;
  };
  const subjectLabel = (subject) => subjectNames[subject] || subject || '—';
  const personalCode = (user) => user.student_code || user.teacher_code || '—';
  const epochValue = (value) => typeof value === 'number' ? value : Date.parse(String(value || '')) / 1000;
  const classSummary = (item) => `${thaiDateTime(epochValue(item.starts_at))} – ${thaiDateTime(epochValue(item.ends_at))}`;

  async function api(path, method = 'GET', body = null) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
    }
    const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === null ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error?.message || `Server error (${response.status})`);
      error.code = payload.error?.code || 'request_failed';
      error.status = response.status;
      if (response.status === 401 && path !== '/api/me') location.replace('index.html');
      throw error;
    }
    return payload;
  }

  async function exportReport() {
    const dataset = $('report-kind').value;
    if (!/^(students|teachers|courses|classes|class_rosters|enrollments|invoices|payments|claims|teaching|payroll|rates)$/.test(dataset)) throw new Error('ชุดข้อมูลไม่ถูกต้อง');
    const rows = [];
    let page = 1;
    do {
      const result = await api(`/api/admin/reports/${dataset}?page=${page}`);
      rows.push(...result.rows);
      page = result.next_page;
    } while (page);
    if (!rows.length) throw new Error('ยังไม่มีข้อมูลในชุดนี้');
    const columns = Object.keys(rows[0]);
    const quote = (value) => {
      let text = String(value ?? '');
      if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = '\uFEFF' + [columns.map(quote).join(','), ...rows.map((row) => columns.map((column) => quote(row[column])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `physics-house-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return rows.length;
  }

  function element(tag, className = '', content = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== '') node.textContent = String(content);
    return node;
  }
  function eyeIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const outline = document.createElementNS(ns, 'path');
    outline.setAttribute('d', 'M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6-10-6-10-6Z');
    const pupil = document.createElementNS(ns, 'circle');
    pupil.setAttribute('cx', '12'); pupil.setAttribute('cy', '12'); pupil.setAttribute('r', '2.5');
    const slash = document.createElementNS(ns, 'path');
    slash.setAttribute('d', 'M3 3 21 21'); slash.setAttribute('class', 'eye-slash');
    svg.append(outline, pupil, slash);
    return svg;
  }
  function cell(row, value, className = '') {
    const node = element('td', className, value);
    row.append(node);
    return node;
  }
  function emptyRow(body, columns, message) {
    const row = element('tr');
    cell(row, message).colSpan = columns;
    body.append(row);
  }
  function actionButton(label, action, id, className = '') {
    const button = element('button', className, label);
    button.type = 'button';
    button.dataset.action = action;
    if (id) button.dataset.id = id;
    return button;
  }
  function option(select, value, label) {
    const node = element('option', '', label);
    node.value = value;
    select.append(node);
  }
  function focusPanel(title, detail, actionLabel = '', target = '') {
    const panel = element('section', 'panel focus-panel');
    const copy = element('div');
    copy.append(element('span', 'focus-eyebrow', 'สิ่งที่ควรรู้ตอนนี้'));
    copy.append(element('h2', '', title));
    copy.append(element('p', 'muted', detail));
    panel.append(copy);
    if (actionLabel && target) {
      const button = actionButton(actionLabel, 'jump', '', 'focus-link');
      button.dataset.target = target;
      panel.append(button);
    }
    return panel;
  }
  function queueItem(count, title, detail, target, urgent = false) {
    const card = element('article', `queue-item${urgent && count ? ' is-urgent' : ''}`);
    const info = element('div');
    info.append(element('strong', 'queue-count', count));
    info.append(element('h3', '', title));
    info.append(element('p', 'muted', detail));
    const button = actionButton('เปิดดูรายการ', 'jump', '', 'queue-link');
    button.dataset.target = target;
    card.append(info, button);
    return card;
  }
  function feedback(message, isError = false) {
    const box = $('live-feedback');
    if (!box) return;
    box.textContent = message;
    box.classList.toggle('is-error', isError);
    box.hidden = !message;
  }
  async function task(control, work, success = '') {
    if (control) control.disabled = true;
    feedback('');
    try {
      await work();
      if (success) feedback(success);
    } catch (error) {
      feedback(error.message || 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง', true);
    } finally {
      if (control) control.disabled = false;
    }
  }

  function shell(user) {
    const role = user.role;
    document.body.innerHTML = `
      <aside class="sidebar" aria-label="เมนูหลัก"><div class="sidebrand"><img src="physics-house-logo-yellow-black.png" alt=""><div><strong>Physics<br>House<span style="color:#ffda39">.</span></strong><small>LEARNING WORKSPACE</small></div></div><div class="nav-label">พื้นที่ของคุณ</div><nav class="side-nav" id="side-nav"></nav><div class="side-profile"><span class="profile-avatar" id="profile-avatar"></span><div><strong id="profile-name"></strong><small id="profile-role"></small></div></div></aside>
      <header class="live-header"><div class="brand"><img class="mark" src="physics-house-logo-yellow-black.png" alt="โลโก้ Physics House"><div>Physics House<div class="muted" id="header-role"></div></div></div><div class="header-actions"><button type="button" id="password-button">เปลี่ยนรหัสผ่าน</button><button type="button" id="logout-button">ออกจากระบบ</button></div></header>
      <nav class="mobile-nav" id="mobile-nav" aria-label="ส่วนต่าง ๆ ของระบบ"></nav>
      <main><div class="intro"><div><div class="eyebrow">PHYSICS HOUSE / LEARNING SPACE</div><h1 id="heading"></h1><p class="muted" id="subtitle"></p></div><span class="badge" id="hero-badge"></span><span class="math m1" aria-hidden="true">E = mc²</span><span class="math m2" aria-hidden="true">∫ x dx</span><span class="math m3" aria-hidden="true">F = ma</span><img class="hero-emblem" src="physics-house-logo-yellow-black.png" alt="ภาพไอน์สไตน์บนโลโก้ Physics House"></div><p id="live-feedback" class="live-feedback" role="status" aria-live="polite" hidden></p><div id="live-content"></div></main>
      <dialog id="live-dialog" class="live-dialog"></dialog>`;
    $('profile-name').textContent = user.name;
    $('profile-avatar').textContent = user.name.trim().slice(0, 1) || 'PH';
    $('profile-role').textContent = roleNames[role];
    $('header-role').textContent = roleNames[role];
    $('hero-badge').textContent = `${personalCode(user) !== '—' ? `${personalCode(user)} · ` : ''}${roleNames[role]}`;
    const headlines = {
      student: ['พื้นที่เรียนรู้ของคุณ', 'คอร์สที่เรียนและยอดค่าเรียนของคุณอยู่ที่นี่'],
      teacher: ['จัดการคาบสอนในที่เดียว', 'ดูตารางสอน ลงเวลาจริง และติดตามค่าจ้างที่อนุมัติ'],
      admin: ['ดูแล Physics House', 'จัดการคอร์ส ค่าเรียน เวลาสอน และการจ่ายค่าจ้าง']
    };
    $('heading').textContent = headlines[role][0];
    $('subtitle').textContent = headlines[role][1];
    const nav = role === 'student'
      ? [['overview', 'ภาพรวม'], ['student-classes', 'ห้องเรียนของฉัน'], ['catalog', 'สมัครเรียน'], ['student-payments', 'แจ้งชำระ']]
      : role === 'teacher'
        ? [['overview', 'คาบสอน'], ['teacher-time', 'ลงเวลาสอน'], ['teacher-payroll', 'ค่าจ้างของฉัน']]
        : [['overview', 'ภาพรวม'], ['admin-accounts', 'บัญชีผู้ใช้'], ['admin-classroom', 'ห้องเรียน'], ['admin-enrollments', 'การสมัครเรียน'], ['admin-finance', 'ค่าเรียน'], ['admin-teaching', 'เวลาสอน'], ['admin-rates', 'อัตราค่าจ้าง'], ['admin-management', 'รายวิชา'], ['admin-payroll', 'จ่ายค่าจ้าง'], ['admin-reports', 'ส่งออกข้อมูล']];
    for (const [target, label] of nav) {
      for (const container of [$('side-nav'), $('mobile-nav')]) {
        const button = actionButton(label, 'jump');
        button.dataset.target = target;
        container.append(button);
      }
    }
    $('logout-button').addEventListener('click', (event) => task(event.currentTarget, async () => {
      await api('/api/auth/logout', 'POST', {});
      location.replace('index.html');
    }));
    $('password-button').addEventListener('click', () => passwordDialog(false));
    document.addEventListener('click', delegatedClick);
    document.addEventListener('submit', delegatedSubmit);
  }

  function formLayout() {
    const role = state.me.role;
    if (role === 'student') return `
      <section id="overview" class="new-section"><div class="stats"><div class="stat"><span>ยอดค้างชำระ</span><strong id="student-outstanding">—</strong><small>จากใบแจ้งยอดของคุณ</small></div><div class="stat"><span>คอร์สที่ลงเรียน</span><strong id="student-course-count">—</strong><small>ข้อมูลจากบัญชีของคุณ</small></div><div class="stat"><span>รายการแจ้งชำระรอตรวจ</span><strong id="student-claim-count">—</strong><small>ผู้ดูแลจะตรวจหลักฐานอ้างอิง</small></div></div><section class="panel"><div class="panel-head"><div><h2>คอร์สและใบแจ้งยอดของฉัน</h2><p class="muted">ยอดคงเหลือคำนวณจากรายการชำระที่ผู้ดูแลบันทึกแล้ว</p></div></div><div class="tablewrap"><table><thead><tr><th>คอร์ส</th><th>เลขที่ใบแจ้งยอด</th><th>ยอดทั้งหมด</th><th>คงเหลือ</th><th>ครบกำหนด</th><th>สถานะ</th></tr></thead><tbody id="student-enrollments"></tbody></table></div></section></section>
      <section id="student-classes" class="panel new-section"><div class="panel-head"><div><h2>ห้องเรียนและตารางเรียนของฉัน</h2><p class="muted">ผู้ดูแลเป็นผู้จัดห้อง ครู เวลา และรายชื่อทุกคน หลังจัดเข้าห้องแล้วจะแสดงที่นี่</p></div></div><div class="tablewrap"><table><thead><tr><th>รหัสวิชา / คอร์ส</th><th>ห้อง</th><th>วันและเวลา</th><th>ผู้สอน</th><th>สถานะ</th></tr></thead><tbody id="student-classes-rows"></tbody></table></div></section>
      <section id="catalog" class="panel new-section"><div class="panel-head"><div><h2>สมัครเรียน</h2><p class="muted">เลือกคอร์สแล้วกรอกระดับชั้น โรงเรียน และข้อมูลผู้ปกครอง ผู้ดูแลจะแจ้งยอดค่าเรียนในระบบภายหลัง</p></div></div><div class="course-grid" id="course-grid"></div></section>
      <section id="student-payments" class="grid new-section"><div class="panel"><h2>แจ้งชำระค่าเรียน</h2><p class="muted">เลือกใบแจ้งยอดที่ผู้ดูแลกำหนด แล้วกรอกเลขอ้างอิงการโอนเพื่อตรวจสอบ</p><form data-action="student-claim" class="live-form"><label>ใบแจ้งยอด<select name="invoice_id" id="claim-invoice" required></select></label><p class="muted" id="claim-display-amount">ยอดที่ต้องชำระ: เลือกใบแจ้งยอดก่อน</p><label>เลขอ้างอิงการโอน<input name="reference" required maxlength="120" autocomplete="off"></label><button class="primary" type="submit">ส่งรายการแจ้งชำระ</button></form><p class="foot">ยอดชำระกำหนดโดยผู้ดูแล นักเรียนแก้ไขเองไม่ได้ · รายละเอียดบัญชีรับโอนจะแจ้งภายหลัง</p></div><div class="panel"><h2>รายการแจ้งชำระที่ส่งแล้ว</h2><div class="tablewrap"><table><thead><tr><th>วันที่</th><th>จำนวน</th><th>เลขอ้างอิง</th><th>สถานะ</th></tr></thead><tbody id="student-claims"></tbody></table></div></div></section>`;
    if (role === 'teacher') return `
      <section id="overview" class="new-section"><div class="stats"><div class="stat"><span>คาบที่ได้รับมอบหมาย</span><strong id="teacher-session-count">—</strong><small>จากตารางสอนจริง</small></div><div class="stat"><span>รายการลงเวลารอตรวจ</span><strong id="teacher-pending-count">—</strong><small>ผู้ดูแลต้องอนุมัติ</small></div><div class="stat"><span>ค่าจ้างที่จ่ายแล้ว</span><strong id="teacher-paid-total">—</strong><small>จากงวดค่าจ้างของคุณ</small></div></div><section class="panel"><div class="panel-head"><div><h2>ตารางสอนและสถานะเวลาสอน</h2><p class="muted">เลือกเช็กชื่อในคาบที่มีนักเรียน และลงเวลาหลังสอนจริง</p></div></div><div class="tablewrap"><table><thead><tr><th>คาบ / คอร์ส</th><th>ห้อง / เวลา</th><th>นักเรียน</th><th>สถานะ</th><th>เวลาสอน</th><th>ดำเนินการ</th></tr></thead><tbody id="teacher-sessions"></tbody></table></div></section></section>
      <section id="teacher-time" class="panel new-section"><h2>ลงเวลาสอนจริง</h2><p class="muted">เวลาอ้างอิงประเทศไทย (UTC+7) บันทึกได้หลังสอนเสร็จ และต้องใกล้คาบที่กำหนด</p><form data-action="teacher-time" class="live-form live-form-grid"><label>คาบเรียน<select name="session_id" id="time-session" required></select></label><label>เริ่มสอนจริง<input name="actual_start" id="actual-start" type="datetime-local" required></label><label>เลิกสอนจริง<input name="actual_end" id="actual-end" type="datetime-local" required></label><label>พัก (นาที)<input name="break_minutes" type="number" min="0" max="480" value="0" required></label><button type="submit" class="primary">ส่งเวลาสอนให้ตรวจ</button></form><p class="foot">ระบบจะตรวจเวลาซ้อนและคำนวณค่าจ้างหลังผู้ดูแลเช็กชื่อครบและยืนยันอัตราแล้ว</p></section>
      <section id="teacher-payroll" class="panel new-section"><h2>ประวัติค่าจ้างของฉัน</h2><p class="muted" id="teacher-approved-unpaid"></p><div class="tablewrap"><table><thead><tr><th>งวด</th><th>ยอด</th><th>สถานะ</th><th>วันที่จ่าย</th><th>รายละเอียด</th></tr></thead><tbody id="teacher-payroll-rows"></tbody></table></div></section>`;
    return `
      <section id="overview" class="new-section"><div class="stats"><div class="stat"><span>คงค้างในใบแจ้งยอดล่าสุด</span><strong id="admin-outstanding">—</strong><small>จาก 100 รายการล่าสุดที่แสดง</small></div><div class="stat"><span>รายการแจ้งชำระรอตรวจ</span><strong id="admin-claim-count">—</strong><small>ตรวจเงินก่อนยืนยัน</small></div><div class="stat"><span>เวลาสอนรอตรวจ</span><strong id="admin-time-count">—</strong><small>ต้องเช็กชื่อครบและมีอัตราที่ยืนยัน</small></div></div></section>
      <section id="admin-accounts" class="panel new-section"><div class="panel-head"><div><h2>จัดการบัญชีนักเรียนและครู</h2><p class="muted">สร้างบัญชี รีเซ็ตรหัสผ่านชั่วคราว และเปิดหรือปิดสิทธิ์เข้าใช้ระบบ</p></div></div><form data-action="admin-user-create" class="live-form live-form-grid"><label>ชื่อ–นามสกุล<input name="name" required maxlength="120"></label><label>อีเมล<input name="email" type="email" required autocomplete="off"></label><label>ประเภทบัญชี<select name="role"><option value="student">นักเรียน</option><option value="teacher">ครู</option></select></label><button type="submit" class="primary">สร้างบัญชี</button></form><p class="foot">รหัสผ่านชั่วคราวจะแสดงเพียงครั้งเดียว ผู้รับต้องเปลี่ยนรหัสเมื่อเข้าสู่ระบบครั้งแรก</p><label class="admin-search-label" for="admin-user-search">ค้นหาชื่อ รหัส หรืออีเมล<input id="admin-user-search" type="search" autocomplete="off" placeholder="พิมพ์เพื่อค้นหาบัญชี"></label><div class="tablewrap"><table><thead><tr><th>รหัสประจำตัว</th><th>ชื่อ / บัญชี</th><th>ประเภท</th><th>สถานะ</th><th>รหัสชั่วคราว</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-user-rows"></tbody></table></div></section>
      <section id="admin-finance" class="new-section"><section class="panel"><h2>แจ้งยอดค่าเรียนให้นักเรียน</h2><p class="muted">นักเรียนสมัครเรียนก่อน จากนั้นผู้ดูแลระบุยอดและวันครบกำหนดเอง ระบบจึงแสดงใบแจ้งยอดในบัญชีนักเรียน</p><form data-action="admin-invoice" class="live-form live-form-grid"><label>นักเรียน / คอร์สที่ยังไม่แจ้งยอด<select name="enrollment_id" id="invoice-enrollment" required></select></label><label>ค่าเรียนที่แจ้ง (บาท)<input name="amount" id="invoice-amount" inputmode="decimal" required placeholder="เลือกคอร์สเพื่อดึงราคา"></label><label>วันครบกำหนด<input name="due_date" type="date" required></label><label>รายละเอียด<input name="description" maxlength="250" placeholder="เช่น ค่าเรียนคอร์สคณิตศาสตร์"></label><button type="submit" class="primary">แจ้งยอดให้นักเรียน</button></form><p class="foot">เลขบัญชีรับโอนจะระบุภายหลัง จึงยังไม่แสดงเลขบัญชีในหน้านักเรียน</p></section><div class="grid"><section class="panel"><h2>รายการแจ้งยอด</h2><div class="tablewrap"><table><thead><tr><th>เลขที่ / นักเรียน</th><th>ยอด</th><th>คงเหลือ</th><th>ครบกำหนด</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-invoices"></tbody></table></div></section><section class="panel"><h2>รายการแจ้งชำระรอตรวจ</h2><div class="tablewrap"><table><thead><tr><th>นักเรียน / อ้างอิง</th><th>ยอด</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-claims"></tbody></table></div></section></div><section class="panel"><h2>บันทึกการรับเงินโดยผู้ดูแล</h2><p class="muted">สำหรับเงินที่ตรวจสอบแล้ว กรุณาใช้เลขอ้างอิงที่ตรวจยืนยันได้</p><form data-action="admin-payment" class="live-form live-form-grid"><label>ใบแจ้งยอด<select name="invoice_id" id="payment-invoice" required></select></label><label>จำนวนที่ได้รับ (บาท)<input name="amount" id="payment-amount" inputmode="decimal" required></label><label>วิธีรับเงิน<input name="method" required maxlength="30" placeholder="เช่น bank_transfer"></label><label>เลขอ้างอิง<input name="reference" required maxlength="120"></label><button type="submit" class="primary">บันทึกรับเงิน</button></form></section></section>
      <section id="admin-teaching" class="panel new-section"><h2>ตรวจเวลาสอน</h2><p class="muted">เช็กชื่อครบทุกคนก่อนอนุมัติ ระบบจะใช้อัตราที่คุณยืนยันไว้</p><div class="tablewrap"><table><thead><tr><th>ครู / คอร์ส</th><th>เวลาสอนจริง</th><th>พัก</th><th>เข้าเรียน</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-times"></tbody></table></div></section>
      <section id="admin-rates" class="panel new-section"><h2>อัตราค่าจ้างครู</h2><p class="muted">อัตรากลางที่ยืนยันแล้วใช้คำนวณค่าจ้างทุกวิชาและทุกครูตามระดับชั้นกับจำนวนผู้เรียน 1–3, 4–6, 7–9 และ 10–13 คน หากมีข้อตกลงเฉพาะครูหรือวิชา ให้เพิ่มอัตราเฉพาะพร้อมแหล่งอ้างอิง</p><div class="tablewrap"><table><thead><tr><th>ขอบเขต / วิชา / ระดับ</th><th>ผู้เรียน</th><th>บาทต่อชั่วโมง</th><th>สถานะ</th><th>ที่มา / ข้อสังเกต</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-rates-rows"></tbody></table></div><details class="rate-create"><summary>เพิ่มอัตราค่าจ้างที่ตรวจสอบแล้ว</summary><form data-action="admin-rate-create" class="live-form live-form-grid"><label>ขอบเขต<select name="scope" id="rate-scope" required><option value="global">อัตรากลางทุกครู</option><option value="teacher">เฉพาะครู</option></select></label><label id="rate-teacher-field" hidden>ครู<select name="teacher_id" id="rate-teacher"></select></label><label id="rate-subject-field" hidden>วิชา<select name="subject" id="rate-subject" required><option value="all">ทุกวิชา</option><option value="science">วิทยาศาสตร์</option><option value="math">คณิตศาสตร์</option><option value="physics">ฟิสิกส์</option><option value="chemistry">เคมี</option><option value="biology">ชีววิทยา</option><option value="chemistry_biology">เคมี/ชีววิทยา</option><option value="english">อังกฤษ</option><option value="thai">ไทย</option><option value="social">สังคม</option><option value="other">อื่น ๆ</option></select></label><label>ระดับ<select name="level"><option value="middle">มัธยมต้น</option><option value="high">มัธยมปลาย</option></select></label><label>จำนวนนักเรียนต่ำสุด<input name="min_students" type="number" min="1" max="100" required></label><label>จำนวนนักเรียนสูงสุด<input name="max_students" type="number" min="1" max="100" required></label><label>บาทต่อชั่วโมง<input name="rate" inputmode="decimal" required></label><label>เริ่มใช้<input name="effective_from" type="date" required></label><label>สิ้นสุด (ถ้ามี)<input name="effective_to" type="date"></label><label class="wide-field">ที่มา/หลักฐานของอัตรา<input name="source_note" required maxlength="250" placeholder="เช่น แถวในชีตอัตราค่าจ้าง หรือข้อตกลงที่ยืนยันแล้ว"></label><button type="submit" class="primary">บันทึกอัตราที่ยืนยันแล้ว</button></form></details></section>
      <section id="admin-classroom" class="new-section"><section class="panel"><div class="panel-head"><div><h2>จัดห้องเรียนและตารางเรียน</h2><p class="muted">ผู้ดูแลเป็นผู้กำหนดห้อง ครู วันเวลา และรายชื่อนักเรียนทุกคน ไม่มีการจัดเข้าห้องอัตโนมัติ</p></div></div><form data-action="admin-class-create" class="live-form live-form-grid"><label>คอร์ส / รหัสวิชา<select name="course_id" id="class-course" required></select></label><label>ครูผู้สอน<select name="teacher_id" id="class-teacher" required></select></label><label>ห้องเรียน<input name="room_name" required maxlength="80" placeholder="เช่น ห้อง A / ออนไลน์ 1"></label><label>เริ่มเรียน (เวลาไทย)<input name="starts_at" type="datetime-local" required></label><label>เลิกเรียน (เวลาไทย)<input name="ends_at" type="datetime-local" required></label><fieldset class="class-roster-field wide-field"><legend>เลือกรายชื่อนักเรียนในห้อง</legend><p class="foot">แสดงเฉพาะผู้สมัครคอร์สที่เลือก กรุณาตรวจชื่อก่อนบันทึก</p><div id="admin-class-students" class="class-student-picker"></div></fieldset><button type="submit" class="primary">สร้างห้องเรียนตามที่จัด</button></form></section><section class="panel"><h2>ห้องเรียนทั้งหมด</h2><p class="muted">เปิดรายชื่อเพื่อดูผู้เรียน เปลี่ยนห้อง เวลา ครู หรือจัดรายชื่อใหม่ได้ก่อนคาบเริ่มและตามเงื่อนไขของระบบ</p><div class="tablewrap"><table><thead><tr><th>คอร์ส / รหัสวิชา</th><th>ห้อง</th><th>วันและเวลา</th><th>ครูผู้สอน</th><th>รายชื่อที่จัด</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-classes-rows"></tbody></table></div></section></section>
      <section id="admin-enrollments" class="panel new-section"><h2>จัดการการสมัครเรียน</h2><p class="muted">ผู้ดูแลเพิ่ม ยกเลิก หรือคืนสถานะการสมัครเรียนได้ การสมัครเรียนไม่จัดเข้าห้องโดยอัตโนมัติ</p><form data-action="admin-enrollment-create" class="live-form live-form-grid"><label>คอร์ส<select name="course_id" id="admin-enroll-course" required></select></label><label>นักเรียน<select name="student_id" id="admin-enroll-student" required></select></label><button type="submit" class="primary">เพิ่มนักเรียนในคอร์ส</button></form><div class="tablewrap"><table><thead><tr><th>รหัสนักเรียน / ชื่อ</th><th>คอร์ส / รหัสวิชา</th><th>สถานะ</th><th>สมัครเมื่อ</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-enrollment-rows"></tbody></table></div></section>
      <section id="admin-management" class="new-section"><section class="panel"><h2>สร้างคอร์สตามรายวิชาของร้าน</h2><p class="muted">มัธยมต้น: วิทยาศาสตร์ คณิตศาสตร์ ภาษาอังกฤษ · 3,500 บาททุกวิชา<br>มัธยมปลาย: ฟิสิกส์ เคมี ชีวะ คณิตศาสตร์ ภาษาอังกฤษ · 4,500 บาททุกวิชา รหัสคอร์สสร้างโดยระบบและไม่ซ้ำกัน</p><form data-action="admin-course" class="live-form live-form-grid"><label>ระดับ<select name="level" id="course-level" required><option value="middle">มัธยมต้น</option><option value="high">มัธยมปลาย</option></select></label><label>รายวิชา<select name="subject" id="course-subject" required></select></label><label>ราคาอ้างอิง<input id="course-fixed-price" value="3,500 บาท" readonly aria-label="ราคาคอร์สตามระดับชั้น"></label><label>จำนวนนักเรียนสูงสุด<input name="capacity" type="number" min="1" max="100" required></label><label>ครูประจำคอร์ส<select name="teacher_id" id="course-teacher" required></select></label><button type="submit" class="primary">สร้างคอร์สและรหัสวิชา</button></form><p class="foot">ผู้ดูแลยังเป็นผู้ตรวจและออกใบแจ้งยอดให้นักเรียนหลังสมัครเรียน</p></section><section class="panel"><h2>คอร์สทั้งหมด</h2><div class="tablewrap"><table><thead><tr><th>รหัสคอร์ส</th><th>วิชา / ระดับ</th><th>ราคา</th><th>ครูประจำ</th><th>จำนวนที่สมัคร</th><th>สถานะ</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-course-rows"></tbody></table></div></section></section>
      <section id="admin-payroll" class="panel new-section"><h2>งวดจ่ายค่าจ้างครู</h2><p class="muted">สร้างงวดจากเวลาสอนที่อนุมัติแล้ว จากนั้นตรวจยอด ปิดงวด และบันทึกเลขอ้างอิงการจ่าย</p><form data-action="admin-payroll-create" class="live-form live-form-grid"><label>ครู<select name="teacher_id" id="payroll-teacher" required></select></label><label>เดือนงวด<input name="period" type="month" required></label><button type="submit" class="primary">สร้างงวดร่าง</button></form><div class="tablewrap"><table><thead><tr><th>ครู / งวด</th><th>ยอด</th><th>สถานะ</th><th>จ่ายเมื่อ</th><th>ดำเนินการ</th></tr></thead><tbody id="admin-payroll-rows"></tbody></table></div></section>
      <section id="admin-reports" class="panel new-section"><h2>ส่งออกข้อมูลสำหรับ Google Sheets</h2><p class="muted">เลือกชุดข้อมูลเพื่อดาวน์โหลด CSV แล้วนำเข้าใน Google Sheets ของร้าน ข้อมูลต้นฉบับอยู่ในฐานข้อมูลของระบบ</p><div class="report-controls"><label for="report-kind">ชุดข้อมูล</label><select id="report-kind"><option value="students">นักเรียนและข้อมูลผู้ปกครอง</option><option value="teachers">ครู</option><option value="courses">คอร์สเรียน</option><option value="classes">ห้องเรียนและตารางสอน</option><option value="class_rosters">รายชื่อในห้องและการเข้าเรียน</option><option value="enrollments">การสมัครเรียน</option><option value="invoices">ใบแจ้งยอด</option><option value="payments">การรับเงิน</option><option value="claims">รายการแจ้งชำระ</option><option value="teaching">เวลาสอน</option><option value="payroll">งวดค่าจ้าง</option><option value="rates">อัตราค่าจ้าง</option></select><button type="button" class="primary" data-action="export-report">ดาวน์โหลด CSV</button></div><p class="foot">ไฟล์นักเรียนมีข้อมูลผู้ปกครอง กรุณาเก็บใน Google Sheet ที่จำกัดสิทธิ์เฉพาะผู้ดูแล</p></section>`;
  }

  async function load() {
    const role = state.me.role;
    if (role === 'student') {
      const [dashboard, catalog, classes] = await Promise.all([api('/api/student/dashboard'), api('/api/courses'), api('/api/student/classes')]);
      state.data = dashboard;
      state.courses = catalog.courses || [];
      state.classes = classes.classes || [];
    } else if (role === 'teacher') {
      const [dashboard, payroll, classes] = await Promise.all([api('/api/teacher/dashboard'), api('/api/teacher/payroll'), api('/api/teacher/classes')]);
      state.data = { ...dashboard, ...payroll };
      state.classes = classes.classes || [];
    } else {
      const [dashboard, rates, catalog, payroll, users, tuition, academic] = await Promise.all([
        api('/api/admin/dashboard'), api('/api/admin/rates'), api('/api/courses'), api('/api/admin/payroll-runs'), api('/api/admin/users'), api('/api/admin/invoices'), api('/api/admin/academic')
      ]);
      state.data = { ...dashboard, ...rates, ...payroll, invoices: tuition.invoices || dashboard.invoices || [], users: academic.users || users.users || [], unbilled_enrollments: tuition.enrollments || [] };
      state.courses = catalog.courses || [];
      state.academic = academic;
      state.classes = academic.classes || [];
    }
    $('live-content').innerHTML = formLayout();
    if (role === 'student') renderStudent();
    else if (role === 'teacher') renderTeacher();
    else renderAdmin();
  }

  function renderStudent() {
    const enrollments = state.data.enrollments || [];
    const invoices = state.data.invoices || [];
    const claims = state.data.payment_claims || [];
    $('student-outstanding').textContent = thaiMoney(invoices.filter((item) => item.status !== 'void').reduce((sum, item) => sum + Math.max(0, item.amount_satang - item.paid_satang), 0));
    $('student-course-count').textContent = String(enrollments.filter((item) => item.status === 'active').length);
    $('student-claim-count').textContent = String(claims.filter((item) => item.status === 'pending').length);
    const overdue = invoices.filter((item) => item.status !== 'void' && item.due_date < bangkokToday() && item.amount_satang > item.paid_satang);
    const unbilled = enrollments.filter((item) => item.status === 'active' && !item.invoice_id);
    const pendingClaims = claims.filter((item) => item.status === 'pending');
    let focus = null;
    if (overdue.length) focus = focusPanel('ตรวจใบแจ้งยอดที่เลยกำหนด', `${overdue.length} รายการยังมียอดคงเหลือ โปรดตรวจรายละเอียดและติดต่อผู้ดูแลเรื่องการชำระ`, 'ดูใบแจ้งยอด', 'student-payments');
    else if (unbilled.length) focus = focusPanel('สมัครเรียนสำเร็จแล้ว', `${unbilled.length} คอร์สรอผู้ดูแลแจ้งยอดค่าเรียน เมื่อแจ้งยอดแล้วจะเห็นใบแจ้งยอดในหน้านี้`);
    else if (pendingClaims.length) focus = focusPanel('กำลังตรวจรายการแจ้งชำระ', `${pendingClaims.length} รายการรอผู้ดูแลตรวจสอบ เมื่อยืนยันแล้ว ยอดคงเหลือจะปรับในระบบ`, 'ดูสถานะ', 'student-payments');
    if (focus) $('overview').querySelector('.stats').after(focus);
    const body = $('student-enrollments');
    if (!enrollments.length) emptyRow(body, 6, 'ยังไม่ได้ลงเรียนคอร์สใด');
    for (const item of enrollments) {
      const row = element('tr');
      cell(row, item.title); cell(row, item.invoice_number || 'รอผู้ดูแลแจ้งยอด'); cell(row, item.invoice_id ? thaiMoney(item.amount_satang) : '—');
      cell(row, item.invoice_id ? thaiMoney(Math.max(0, item.amount_satang - item.paid_satang)) : '—');
      cell(row, thaiDate(item.due_date)); cell(row, item.invoice_id ? status(item.invoice_status) : 'รอแจ้งยอด'); body.append(row);
    }
    const classBody = $('student-classes-rows');
    if (!state.classes.length) emptyRow(classBody, 5, 'ยังไม่ได้รับการจัดเข้าห้องเรียน ผู้ดูแลจะกำหนดห้องและเวลาให้');
    for (const item of state.classes) {
      const row = element('tr');
      const courseCell = cell(row, item.course_title);
      courseCell.prepend(element('strong', 'record-code', `${item.course_code || '—'} · `));
      cell(row, item.room_name || '—');
      cell(row, classSummary(item));
      cell(row, `${item.teacher_name || '—'}${item.teacher_code ? ` · ${item.teacher_code}` : ''}`);
      cell(row, status(item.status)); classBody.append(row);
    }
    const catalog = $('course-grid');
    const enrolled = new Set(enrollments.map((item) => item.course_id));
    if (!state.courses.length) catalog.append(element('p', 'muted', 'ยังไม่มีคอร์สที่เปิดรับ'));
    for (const course of state.courses) {
      const card = element('article', 'course-card');
      const tag = element('span', 'subject-tag', `${subjectLabel(course.subject)} · ${levelNames[course.level] || '—'}`);
      const title = element('h3', '', course.title);
      const teacher = element('p', 'muted', `ครู ${course.teacher_name}`);
      const price = element('strong', 'course-price', thaiMoney(course.price_satang));
      const note = element('p', 'muted', 'ผู้ดูแลจะออกใบแจ้งยอดหลังสมัครเรียน');
      const seats = element('p', 'muted', `รับ ${course.enrolled_count}/${course.capacity} คน`);
      const button = actionButton(enrolled.has(course.id) ? 'ลงเรียนแล้ว' : course.enrolled_count >= course.capacity ? 'เต็มแล้ว' : 'สมัครคอร์สนี้', 'student-enroll', course.id, 'primary');
      button.disabled = enrolled.has(course.id) || course.enrolled_count >= course.capacity;
      card.append(tag, element('small', 'record-code', course.course_code || ''), title, teacher, price, note, seats, button); catalog.append(card);
    }
    const invoiceSelect = $('claim-invoice');
    option(invoiceSelect, '', 'เลือกใบแจ้งยอด');
    const pendingInvoiceIds = new Set(pendingClaims.map((claim) => claim.invoice_id));
    for (const invoice of invoices.filter((item) => item.status !== 'void' && item.amount_satang > item.paid_satang && !pendingInvoiceIds.has(item.id))) {
      option(invoiceSelect, invoice.id, `${invoice.invoice_number} · ${invoice.description} · คงเหลือ ${thaiMoney(invoice.amount_satang - invoice.paid_satang)}`);
    }
    invoiceSelect.addEventListener('change', () => {
      const invoice = invoices.find((item) => item.id === invoiceSelect.value);
      $('claim-display-amount').textContent = invoice ? `ยอดที่ต้องชำระ: ${thaiMoney(invoice.amount_satang - invoice.paid_satang)}` : 'ยอดที่ต้องชำระ: เลือกใบแจ้งยอดก่อน';
    });
    const claimBody = $('student-claims');
    if (!claims.length) emptyRow(claimBody, 4, 'ยังไม่มีรายการแจ้งชำระ');
    for (const claim of claims) {
      const row = element('tr');
      cell(row, thaiDateTime(claim.created_at)); cell(row, thaiMoney(claim.amount_satang));
      cell(row, claim.reference); cell(row, status(claim.status)); claimBody.append(row);
    }
  }

  function renderTeacher() {
    const sessions = state.data.sessions || [];
    const payroll = state.data.payroll_runs || [];
    $('teacher-session-count').textContent = String(sessions.filter((item) => item.status === 'scheduled').length);
    $('teacher-pending-count').textContent = String(sessions.filter((item) => item.time_status === 'submitted').length);
    $('teacher-paid-total').textContent = thaiMoney(payroll.filter((run) => run.status === 'paid').reduce((sum, run) => sum + run.total_satang, 0));
    const rejected = sessions.filter((item) => item.time_status === 'rejected');
    const nextSession = sessions.filter((item) => item.status === 'scheduled' && Number(item.starts_at) > Date.now() / 1000)
      .sort((a, b) => a.starts_at - b.starts_at)[0];
    let focus = null;
    if (rejected.length) focus = focusPanel('มีเวลาสอนที่ต้องส่งใหม่', `${rejected.length} คาบถูกส่งกลับ โปรดตรวจคาบและลงเวลาสอนอีกครั้ง`, 'ดูคาบสอน', 'overview');
    else if (nextSession) {
      const nextClass = state.classes.find((item) => item.id === nextSession.id);
      focus = focusPanel('คาบสอนถัดไป', `${nextSession.title} · ${nextClass?.room_name || 'รอแจ้งห้อง'} · ${thaiDateTime(nextSession.starts_at)} – ${thaiDateTime(nextSession.ends_at)}`, 'ดูตารางสอน', 'overview');
    }
    if (focus) $('overview').querySelector('.stats').after(focus);
    const body = $('teacher-sessions');
    if (!sessions.length) emptyRow(body, 6, 'ยังไม่มีคาบสอนที่ได้รับมอบหมาย');
    const nowEpoch = Date.now() / 1000;
    const orderedSessions = [...sessions].sort((a, b) => {
      const aUpcoming = a.status === 'scheduled' && Number(a.starts_at) >= nowEpoch;
      const bUpcoming = b.status === 'scheduled' && Number(b.starts_at) >= nowEpoch;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      return aUpcoming ? a.starts_at - b.starts_at : b.starts_at - a.starts_at;
    });
    for (const item of orderedSessions) {
      const classroom = state.classes.find((entry) => entry.id === item.id);
      const row = element('tr');
      if (item.status === 'scheduled' && Number(item.starts_at) >= nowEpoch) row.classList.add('is-upcoming');
      const title = cell(row, item.title);
      title.append(element('div', 'muted', `${classroom?.course_code || ''} ${subjectLabel(item.subject)}`.trim()));
      const location = cell(row, classroom?.room_name || '—');
      location.append(element('div', 'muted', `${thaiDateTime(item.starts_at)} – ${thaiDateTime(item.ends_at)}`));
      cell(row, `${classroom?.roster_count ?? 0} คน`);
      cell(row, status(item.status));
      const timeState = item.time_status === 'rejected' ? 'ส่งกลับ · ลงเวลาใหม่ได้'
        : item.time_status === 'approved' ? `อนุมัติแล้ว · ${thaiMoney(item.amount_satang)}`
          : item.time_status ? status(item.time_status) : 'ยังไม่ลงเวลา';
      const timeCell = cell(row, timeState, 'time-status');
      timeCell.dataset.state = item.time_status || 'none';
      if (item.time_status === 'rejected' && item.rejection_reason) {
        timeCell.append(element('div', 'muted', `เหตุผล: ${item.rejection_reason}`));
      }
      const actions = cell(row, ''); actions.className = 'row-actions';
      if (item.status === 'scheduled') actions.append(actionButton('เช็กชื่อ', 'roster', item.id));
      if ((!item.time_entry_id || item.time_status === 'rejected') && item.status === 'scheduled') actions.append(actionButton(item.time_status === 'rejected' ? 'ส่งเวลาใหม่' : 'ลงเวลา', 'select-time', item.id, 'primary'));
      body.append(row);
    }
    const select = $('time-session');
    option(select, '', 'เลือกคาบเรียน');
    for (const item of sessions.filter((entry) => entry.status === 'scheduled' && (!entry.time_entry_id || entry.time_status === 'rejected'))) {
      option(select, item.id, `${item.title} · ${thaiDateTime(item.starts_at)}`);
    }
    select.addEventListener('change', () => setTeacherTime(select.value));
    const payBody = $('teacher-payroll-rows');
    $('teacher-approved-unpaid').textContent = `ค่าจ้างที่อนุมัติแล้วและยังไม่เข้ารอบจ่าย: ${thaiMoney(state.data.approved_unpaid_satang || 0)}`;
    if (!payroll.length) emptyRow(payBody, 5, 'ยังไม่มีงวดค่าจ้างที่ปิดยอด');
    for (const run of payroll) {
      const row = element('tr');
      cell(row, run.period); cell(row, thaiMoney(run.total_satang)); cell(row, status(run.status));
      cell(row, run.paid_at ? thaiDateTime(run.paid_at) : 'ยังไม่จ่าย');
      cell(row, '').append(actionButton('ดูรายการ', 'payroll-detail', run.id)); payBody.append(row);
    }
  }

  function setTeacherTime(sessionId) {
    const session = (state.data.sessions || []).find((item) => item.id === sessionId);
    $('time-session').value = sessionId || '';
    $('actual-start').value = session ? bangkokInput(session.starts_at) : '';
    $('actual-end').value = session ? bangkokInput(session.ends_at) : '';
  }

  function fillSubjectOptions() {
    const level = $('course-level').value;
    const select = $('course-subject');
    select.replaceChildren();
    for (const [code, label] of courseSubjects[level] || []) option(select, code, label);
    $('course-fixed-price').value = level === 'high' ? '4,500 บาท' : '3,500 บาท';
  }

  function eligibleStudents(courseId) {
    const students = new Map();
    for (const enrollment of state.academic?.enrollments || []) {
      if (enrollment.course_id === courseId && enrollment.status === 'active') {
        students.set(enrollment.student_id, enrollment);
      }
    }
    return [...students.values()].sort((a, b) => String(a.student_name).localeCompare(String(b.student_name), 'th'));
  }

  function fillClassStudentPicker(courseId, selectedIds = [], container = $('admin-class-students')) {
    if (!container) return;
    container.replaceChildren();
    if (!courseId) { container.append(element('p', 'muted', 'เลือกคอร์สก่อน แล้วระบบจะแสดงผู้สมัครเรียนที่จัดเข้าห้องได้')); return; }
    const eligible = eligibleStudents(courseId);
    if (!eligible.length) { container.append(element('p', 'muted', 'ยังไม่มีนักเรียนที่สมัครคอร์สนี้')); return; }
    const chosen = new Set(selectedIds);
    for (const student of eligible) {
      const label = element('label', 'class-student-option');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.name = 'student_ids'; checkbox.value = student.student_id;
      checkbox.checked = chosen.has(student.student_id);
      label.append(checkbox, element('span', '', `${student.student_code || '—'} · ${student.student_name}`));
      container.append(label);
    }
  }

  function chosenStudentIds(form) {
    return [...form.querySelectorAll('input[name="student_ids"]:checked')].map((node) => validId(node.value));
  }

  function fillAdminEnrollmentStudents(courseId) {
    const select = $('admin-enroll-student');
    select.replaceChildren(); option(select, '', courseId ? 'เลือกนักเรียน' : 'เลือกคอร์สก่อน');
    const course = (state.academic?.courses || []).find((item) => item.id === courseId);
    if (!course) return;
    for (const person of state.academic?.users || []) {
      if (person.role !== 'student' || person.status !== 'active' || !person.grade) continue;
      const middleGrade = ['M1', 'M2', 'M3'].includes(person.grade);
      if (middleGrade !== (course.level === 'middle')) continue;
      if ((state.academic?.enrollments || []).some((entry) => entry.course_id === courseId && entry.student_id === person.id)) continue;
      option(select, person.id, `${person.student_code || '—'} · ${person.name} · ${person.grade}`);
    }
  }

  function renderAdmin() {
    const invoices = state.data.invoices || [];
    const unbilled = state.data.unbilled_enrollments || [];
    const claims = state.data.pending_payment_claims || [];
    const times = state.data.pending_time_entries || [];
    const rates = state.data.rates || [];
    const runs = state.data.payroll_runs || [];
    const users = state.data.users || [];
    const notifications = state.data.notifications || {};
    const notificationCounts = notifications.counts || {};
    const failedNotices = notifications.failed || [];
    const userBody = $('admin-user-rows');
    if (!users.length) emptyRow(userBody, 6, 'ยังไม่มีบัญชีผู้ใช้');
    for (const person of users) {
      const row = element('tr');
      cell(row, personalCode(person), 'record-code');
      const identity = cell(row, person.name); identity.append(element('div', 'muted', person.email || person.username || '—'));
      cell(row, roleNames[person.role] || person.role); cell(row, person.status === 'active' ? 'ใช้งาน' : 'ปิดใช้งาน');
      cell(row, person.must_change_password ? 'ต้องเปลี่ยนเมื่อเข้าสู่ระบบ' : 'เปลี่ยนแล้ว');
      const actions = cell(row, ''); actions.className = 'row-actions';
      if (person.role === 'student') actions.append(actionButton('ข้อมูลนักเรียน', 'admin-profile', person.id));
      if (person.role !== 'admin') {
        actions.append(actionButton('แก้ชื่อ/อีเมล', 'edit-user', person.id));
        actions.append(actionButton('รีเซ็ตรหัส', 'reset-user', person.id));
        actions.append(actionButton(person.status === 'active' ? 'ปิดบัญชี' : 'เปิดบัญชี', person.status === 'active' ? 'disable-user' : 'enable-user', person.id));
      }
      userBody.append(row);
    }
    $('admin-user-search').addEventListener('input', (event) => {
      const query = event.currentTarget.value.trim().toLocaleLowerCase('th');
      for (const row of userBody.rows) row.hidden = Boolean(query) && !row.textContent.toLocaleLowerCase('th').includes(query);
    });
    $('admin-outstanding').textContent = thaiMoney(invoices.filter((item) => item.status !== 'void').reduce((sum, item) => sum + Math.max(0, item.amount_satang - item.paid_satang), 0));
    $('admin-outstanding').nextElementSibling.textContent = `จาก ${invoices.length} ใบแจ้งยอดล่าสุดที่แสดง`;
    $('admin-claim-count').textContent = String(claims.length);
    $('admin-time-count').textContent = String(times.length);
    const overdue = invoices.filter((item) => item.status !== 'void' && item.due_date < bangkokToday() && item.amount_satang > item.paid_satang);
    const queue = element('section', 'panel action-queue');
    queue.append(element('h2', '', 'งานที่ต้องจัดการ'));
    queue.append(element('p', 'muted', 'จำนวนแสดงจากข้อมูลล่าสุดที่โหลดในหน้านี้ กดเพื่อไปยังรายการที่เกี่ยวข้อง'));
    const queueGrid = element('div', 'queue-grid');
    queueGrid.append(
      queueItem(unbilled.length, 'รอแจ้งยอดค่าเรียน', 'นักเรียนสมัครคอร์สแล้ว ผู้ดูแลต้องกำหนดยอด', 'admin-finance', true),
      queueItem(claims.length, 'รอตรวจการชำระ', 'ตรวจเงินและเลขอ้างอิงก่อนกดยืนยัน', 'admin-claims', true),
      queueItem(times.length, 'รอตรวจเวลาสอน', 'เช็กชื่อและตรวจอัตราก่อนอนุมัติ', 'admin-teaching', true),
      queueItem(overdue.length, 'ใบแจ้งยอดเลยกำหนด', 'ยังมียอดคงเหลือที่ต้องติดตาม', 'admin-invoices', true),
      queueItem(Number(notificationCounts.dead) || 0, 'อีเมลส่งไม่สำเร็จ', 'ตรวจสถานะการแจ้งเตือน', 'admin-notifications', true)
    );
    queue.append(queueGrid);
    $('overview').querySelector('.stats').after(queue);
    const notificationPanel = element('section', 'panel');
    notificationPanel.id = 'admin-notifications';
    notificationPanel.append(element('h2', '', 'สถานะอีเมลแจ้งเตือน'));
    notificationPanel.append(element('p', 'muted', `รอส่ง ${Number(notificationCounts.pending || 0) + Number(notificationCounts.sending || 0)} · ส่งแล้ว ${Number(notificationCounts.sent) || 0} · ส่งไม่สำเร็จ ${Number(notificationCounts.dead) || 0}`));
    if (failedNotices.length) {
      const wrap = element('div', 'tablewrap');
      const table = element('table');
      const head = element('thead');
      const headRow = element('tr');
      for (const label of ['เวลาที่เกิด', 'เหตุการณ์', 'จำนวนครั้ง', 'สาเหตุ']) headRow.append(element('th', '', label));
      head.append(headRow);
      const body = element('tbody');
      for (const notice of failedNotices) {
        const row = element('tr');
        cell(row, thaiDateTime(notice.created_at));
        cell(row, notice.event_type || 'ข้อมูลอัปเดต');
        cell(row, String(notice.attempts ?? '—'));
        cell(row, notice.last_error_code || 'ไม่ทราบสาเหตุ');
        body.append(row);
      }
      table.append(head, body); wrap.append(table); notificationPanel.append(wrap);
    } else notificationPanel.append(element('p', 'muted', 'ยังไม่มีอีเมลส่งไม่สำเร็จ'));
    queue.after(notificationPanel);
    const enrollmentSelect = $('invoice-enrollment'); option(enrollmentSelect, '', 'เลือกนักเรียนและคอร์ส');
    for (const enrollment of unbilled) option(enrollmentSelect, enrollment.enrollment_id, `${enrollment.student_name} · ${enrollment.course_title}`);
    enrollmentSelect.addEventListener('change', () => {
      const enrollment = unbilled.find((item) => item.enrollment_id === enrollmentSelect.value);
      const course = (state.academic?.courses || []).find((item) => item.id === enrollment?.course_id);
      $('invoice-amount').value = course ? (Number(course.price_satang) / 100).toFixed(2) : '';
    });
    const invoiceBody = $('admin-invoices');
    if (!invoices.length) emptyRow(invoiceBody, 6, 'ยังไม่มีใบแจ้งยอด');
    const orderedInvoices = [...invoices].sort((a, b) => {
      const aOverdue = overdue.includes(a) ? 1 : 0;
      const bOverdue = overdue.includes(b) ? 1 : 0;
      return bOverdue - aOverdue || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
    for (const invoice of orderedInvoices) {
      const row = element('tr'); const title = cell(row, invoice.invoice_number); title.append(element('div', 'muted', invoice.student_name));
      cell(row, thaiMoney(invoice.amount_satang)); cell(row, thaiMoney(Math.max(0, invoice.amount_satang - invoice.paid_satang)));
      cell(row, thaiDate(invoice.due_date));
      const isOverdue = overdue.includes(invoice);
      const invoiceState = cell(row, isOverdue ? 'เกินกำหนด' : status(invoice.status), 'invoice-status');
      if (isOverdue) { row.classList.add('is-overdue'); invoiceState.dataset.state = 'overdue'; }
      const actions = cell(row, ''); actions.className = 'row-actions';
      if (invoice.status === 'unpaid' && !claims.some((claim) => claim.invoice_id === invoice.id)) actions.append(actionButton('แก้ยอด', 'edit-invoice-amount', invoice.id));
      if (invoice.status === 'unpaid' || invoice.status === 'partial') actions.append(actionButton('เปลี่ยนกำหนด', 'edit-invoice-due-date', invoice.id));
      if (invoice.status === 'unpaid' && !invoice.paid_satang && !claims.some((claim) => claim.invoice_id === invoice.id)) actions.append(actionButton('ยกเลิกใบแจ้งยอด', 'void-invoice', invoice.id));
      if (invoice.status === 'void') actions.append(actionButton('คืนสถานะใบแจ้งยอด', 'restore-invoice', invoice.id));
      invoiceBody.append(row);
    }
    const claimBody = $('admin-claims');
    if (!claims.length) emptyRow(claimBody, 3, 'ไม่มีรายการรอตรวจ');
    for (const claim of claims) {
      const row = element('tr'); const person = cell(row, claim.student_name); person.append(element('div', 'muted', claim.reference));
      cell(row, thaiMoney(claim.amount_satang)); const actions = cell(row, ''); actions.className = 'row-actions';
      actions.append(actionButton('ยืนยันรับเงิน', 'approve-claim', claim.id, 'primary'), actionButton('ปฏิเสธ', 'reject-claim', claim.id)); claimBody.append(row);
    }
    const invoiceSelect = $('payment-invoice'); option(invoiceSelect, '', 'เลือกใบแจ้งยอด');
    for (const invoice of invoices.filter((item) => item.status !== 'void' && item.amount_satang > item.paid_satang)) {
      option(invoiceSelect, invoice.id, `${invoice.invoice_number} · ${invoice.student_name} · คงเหลือ ${thaiMoney(invoice.amount_satang - invoice.paid_satang)}`);
    }
    invoiceSelect.addEventListener('change', () => {
      const invoice = invoices.find((item) => item.id === invoiceSelect.value);
      $('payment-amount').value = invoice ? ((invoice.amount_satang - invoice.paid_satang) / 100).toFixed(2) : '';
    });
    const timeBody = $('admin-times');
    if (!times.length) emptyRow(timeBody, 5, 'ไม่มีเวลาสอนรอตรวจ');
    for (const item of times) {
      const row = element('tr'); const title = cell(row, item.teacher_name); title.append(element('div', 'muted', item.course_title));
      cell(row, `${thaiDateTime(item.actual_start)} – ${thaiDateTime(item.actual_end)}`); cell(row, `${item.break_minutes} นาที`);
      cell(row, `${item.student_count} คน`); const actions = cell(row, ''); actions.className = 'row-actions';
      actions.append(actionButton('เช็กชื่อ', 'roster', item.session_id), actionButton('อนุมัติ', 'approve-time', item.id, 'primary'), actionButton('อนุมัติยอดพิเศษ', 'override-time', item.id), actionButton('ปฏิเสธ', 'reject-time', item.id)); timeBody.append(row);
    }
    const rateBody = $('admin-rates-rows');
    if (!rates.length) emptyRow(rateBody, 6, 'ยังไม่มีอัตราค่าจ้าง');
    for (const rule of rates) {
      const row = element('tr');
      const scope = rule.scope === 'global' || !rule.teacher_id ? 'อัตรากลาง' : (rule.teacher_label || 'เฉพาะครู');
      const subject = rule.subject === 'all' ? 'ทุกวิชา' : rule.subject;
      cell(row, `${scope} · ${subject} · ${rule.level === 'high' ? 'มัธยมปลาย' : 'มัธยมต้น'}`);
      cell(row, `${rule.min_students}–${rule.max_students} คน`); cell(row, thaiMoney(rule.rate_satang_per_hour));
      cell(row, status(rule.state)); cell(row, rule.source_note, 'rate-note');
      const actions = cell(row, ''); actions.className = 'row-actions';
      if (rule.state === 'pending_confirmation') actions.append(actionButton('ตรวจและยืนยัน', 'confirm-rate', rule.id, 'primary'));
      if (rule.state === 'confirmed' && !rule.effective_to) actions.append(actionButton('กำหนดวันสิ้นสุด', 'end-rate', rule.id));
      rateBody.append(row);
    }
    const teachers = users.filter((person) => person.role === 'teacher' && person.status === 'active');
    for (const id of ['course-teacher', 'class-teacher', 'payroll-teacher', 'rate-teacher']) {
      const select = $(id); option(select, '', 'เลือกครู');
      for (const teacher of teachers) option(select, teacher.id, `${teacher.teacher_code || '—'} · ${teacher.name}`);
    }
    const rateScope = $('rate-scope');
    const syncRateScope = () => {
      const teacherOnly = rateScope.value === 'teacher';
      $('rate-teacher-field').hidden = !teacherOnly;
      $('rate-teacher').required = teacherOnly;
      if (!teacherOnly) $('rate-teacher').value = '';
      $('rate-subject-field').hidden = !teacherOnly;
      if (!teacherOnly) $('rate-subject').value = 'all';
    };
    rateScope.addEventListener('change', syncRateScope);
    syncRateScope();
    fillSubjectOptions();
    $('course-level').addEventListener('change', fillSubjectOptions);
    const classCourse = $('class-course'); option(classCourse, '', 'เลือกคอร์ส');
    for (const course of state.academic?.courses || []) {
      if (course.active) option(classCourse, course.id, `${course.course_code || '—'} · ${course.title}`);
    }
    classCourse.addEventListener('change', () => {
      const course = (state.academic?.courses || []).find((item) => item.id === classCourse.value);
      $('class-teacher').value = course?.teacher_id || '';
      fillClassStudentPicker(classCourse.value);
    });
    fillClassStudentPicker('');
    const courseBody = $('admin-course-rows');
    const academicCourses = state.academic?.courses || [];
    if (!academicCourses.length) emptyRow(courseBody, 7, 'ยังไม่มีคอร์สเรียน');
    for (const course of academicCourses) {
      const row = element('tr');
      cell(row, course.course_code || '—', 'record-code');
      cell(row, `${subjectLabel(course.subject)} · ${levelNames[course.level] || '—'}`);
      cell(row, thaiMoney(course.price_satang)); cell(row, course.teacher_name || '—');
      cell(row, `${course.enrolled_count ?? 0}/${course.capacity}`);
      cell(row, course.active ? 'เปิดรับ' : 'ปิดรับ');
      cell(row, '').append(actionButton('แก้ไขคอร์ส', 'course-edit', course.id));
      courseBody.append(row);
    }
    const classBody = $('admin-classes-rows');
    if (!state.classes.length) emptyRow(classBody, 7, 'ยังไม่มีห้องเรียน ผู้ดูแลสามารถสร้างและเลือกนักเรียนเองได้');
    for (const classroom of state.classes) {
      const row = element('tr');
      const subject = cell(row, classroom.course_title);
      subject.prepend(element('strong', 'record-code', `${classroom.course_code || '—'} · `));
      cell(row, classroom.room_name || '—');
      cell(row, classSummary(classroom));
      cell(row, `${classroom.teacher_code || '—'} · ${classroom.teacher_name || '—'}`);
      const roster = cell(row, `${classroom.roster_count ?? classroom.students?.length ?? 0} คน`);
      const names = (classroom.students || []).slice(0, 3).map((person) => person.name).join(', ');
      if (names) roster.append(element('div', 'muted', `${names}${(classroom.students || []).length > 3 ? '…' : ''}`));
      cell(row, status(classroom.status));
      const actions = cell(row, ''); actions.className = 'row-actions';
      actions.append(actionButton('ดูห้อง', 'class-detail', classroom.id));
      if (classroom.status === 'scheduled') actions.append(actionButton('แก้ไข', 'class-edit', classroom.id, 'primary'), actionButton('ยกเลิก', 'class-cancel', classroom.id));
      classBody.append(row);
    }
    const enrollCourse = $('admin-enroll-course'); option(enrollCourse, '', 'เลือกคอร์ส');
    for (const course of academicCourses.filter((item) => item.active)) option(enrollCourse, course.id, `${course.course_code || '—'} · ${course.title}`);
    enrollCourse.addEventListener('change', () => fillAdminEnrollmentStudents(enrollCourse.value));
    fillAdminEnrollmentStudents('');
    const enrollmentBody = $('admin-enrollment-rows');
    const allEnrollments = state.academic?.enrollments || [];
    if (!allEnrollments.length) emptyRow(enrollmentBody, 5, 'ยังไม่มีการสมัครเรียน');
    for (const enrollment of allEnrollments) {
      const row = element('tr');
      cell(row, `${enrollment.student_code || '—'} · ${enrollment.student_name}`);
      cell(row, `${enrollment.course_code || '—'} · ${enrollment.course_title}`);
      cell(row, enrollment.status === 'active' ? 'กำลังเรียน' : 'ยกเลิก');
      cell(row, thaiDateTime(enrollment.created_at));
      const actions = cell(row, ''); actions.className = 'row-actions';
      actions.append(actionButton(enrollment.status === 'active' ? 'ยกเลิกการสมัคร' : 'คืนสถานะ', enrollment.status === 'active' ? 'enrollment-cancel' : 'enrollment-restore', enrollment.id));
      enrollmentBody.append(row);
    }
    const payBody = $('admin-payroll-rows');
    if (!runs.length) emptyRow(payBody, 5, 'ยังไม่มีงวดค่าจ้าง');
    for (const run of runs) {
      const row = element('tr'); cell(row, `${run.teacher_name} · ${run.period}`); cell(row, thaiMoney(run.total_satang));
      cell(row, status(run.status)); cell(row, run.paid_at ? thaiDateTime(run.paid_at) : '—');
      const actions = cell(row, ''); actions.className = 'row-actions';
      actions.append(actionButton('ดูรายการ', 'payroll-detail', run.id));
      if (run.status === 'draft') actions.append(actionButton('ปรับยอด', 'adjust-payroll', run.id), actionButton('ปิดงวด', 'finalize-payroll', run.id, 'primary'), actionButton('ยกเลิกร่าง', 'cancel-payroll', run.id));
      if (run.status === 'finalized') actions.append(actionButton('บันทึกจ่าย', 'pay-payroll', run.id, 'primary'));
      payBody.append(row);
    }
  }

  async function delegatedSubmit(event) {
    const form = event.target.closest('form[data-action]');
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    await task(submit, async () => {
      let message = 'บันทึกข้อมูลแล้ว';
      switch (form.dataset.action) {
        case 'student-claim':
          await api('/api/student/payment-claims', 'POST', { invoice_id: validId(values.invoice_id), reference: values.reference.trim() });
          message = 'ส่งรายการแจ้งชำระแล้ว รอผู้ดูแลตรวจสอบ'; break;
        case 'teacher-time':
          await api('/api/teacher/time-entries', 'POST', { session_id: validId(values.session_id), actual_start: bangkokISO(values.actual_start), actual_end: bangkokISO(values.actual_end), break_minutes: Number(values.break_minutes) });
          message = 'ส่งเวลาสอนให้ผู้ดูแลตรวจแล้ว'; break;
        case 'admin-user-create': {
          const created = await api('/api/admin/users', 'POST', { name: values.name.trim(), email: values.email.trim(), role: values.role });
          await load(); showCredential(created); message = 'สร้างบัญชีแล้ว'; break;
        }
        case 'admin-course':
          await api('/api/admin/courses', 'POST', { subject: values.subject, level: values.level, teacher_id: validId(values.teacher_id), capacity: Number(values.capacity) });
          message = 'สร้างคอร์สและรหัสวิชาแล้ว'; break;
        case 'admin-class-create':
          await api('/api/admin/classes', 'POST', {
            room_name: values.room_name.trim(), course_id: validId(values.course_id), teacher_id: validId(values.teacher_id),
            starts_at: bangkokISO(values.starts_at), ends_at: bangkokISO(values.ends_at),
            student_ids: chosenStudentIds(form)
          });
          message = 'จัดห้องเรียนและรายชื่อนักเรียนแล้ว'; break;
        case 'admin-enrollment-create':
          await api('/api/admin/enrollments', 'POST', { course_id: validId(values.course_id), student_id: validId(values.student_id) });
          message = 'เพิ่มนักเรียนในคอร์สแล้ว กรุณาจัดเข้าห้องและแจ้งยอดตามขั้นตอน'; break;
        case 'admin-invoice':
          await api('/api/admin/invoices', 'POST', { enrollment_id: validId(values.enrollment_id), amount_satang: toSatang(values.amount), due_date: values.due_date, description: values.description.trim() });
          message = 'แจ้งยอดค่าเรียนในบัญชีนักเรียนแล้ว'; break;
        case 'admin-rate-create':
          await api('/api/admin/rates', 'POST', {
            scope: values.scope,
            ...(values.scope === 'teacher' ? { teacher_id: validId(values.teacher_id) } : {}),
            subject: values.scope === 'global' ? 'all' : values.subject, level: values.level,
            min_students: Number(values.min_students), max_students: Number(values.max_students),
            rate_satang_per_hour: toSatang(values.rate), effective_from: values.effective_from,
            effective_to: values.effective_to || null, source_note: values.source_note.trim()
          });
          message = 'บันทึกอัตราค่าจ้างที่ยืนยันแล้ว'; break;
        case 'admin-payment':
          await api('/api/admin/payments', 'POST', { invoice_id: validId(values.invoice_id), amount_satang: toSatang(values.amount), method: values.method.trim(), reference: values.reference.trim() });
          message = 'บันทึกการรับเงินแล้ว'; break;
        case 'admin-payroll-create':
          await api('/api/admin/payroll-runs', 'POST', { teacher_id: validId(values.teacher_id), period: values.period });
          message = 'สร้างงวดค่าจ้างร่างแล้ว'; break;
        default: throw new Error('ยังไม่รองรับการดำเนินการนี้');
      }
      if (form.dataset.action !== 'admin-user-create') await load();
      feedback(message);
    });
  }

  async function delegatedClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'export-report') {
      await task(button, async () => { const count = await exportReport(); feedback(`ดาวน์โหลดข้อมูล ${count} รายการแล้ว`); });
      return;
    }
    if (action === 'jump') {
      const target = $(button.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (action === 'select-time') {
      setTeacherTime(button.dataset.id);
      $('teacher-time').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    await task(button, async () => {
      const id = validId(button.dataset.id);
      let message = 'บันทึกข้อมูลแล้ว';
      switch (action) {
        case 'enrollment-cancel':
        case 'enrollment-restore':
          if (!confirm(action === 'enrollment-cancel' ? 'ยกเลิกการสมัครเรียนนี้หรือไม่? หากมีห้องเรียนในอนาคต ต้องนำออกจากห้องก่อน' : 'คืนสถานะการสมัครเรียนนี้หรือไม่?')) return;
          await api(`/api/admin/enrollments/${id}/${action === 'enrollment-cancel' ? 'cancel' : 'restore'}`, 'POST', {});
          message = action === 'enrollment-cancel' ? 'ยกเลิกการสมัครเรียนแล้ว' : 'คืนสถานะการสมัครเรียนแล้ว'; break;
        case 'class-detail':
          classDetailDialog(id); return;
        case 'class-edit':
          classEditDialog(id); return;
        case 'class-cancel':
          if (!confirm('ยกเลิกห้องเรียนนี้หรือไม่? ตารางเรียนของนักเรียนและครูจะเปลี่ยนตาม')) return;
          await api(`/api/admin/classes/${id}/cancel`, 'POST', {});
          message = 'ยกเลิกห้องเรียนแล้ว'; break;
        case 'student-enroll':
          {
            const profile = state.data.profile || {};
            const answer = await fieldsDialog('สมัครเรียนและข้อมูลติดต่อผู้ปกครอง', [
              { name: 'grade', label: 'ระดับชั้น', type: 'select', required: true, value: profile.grade, options: [['M1','ม.1'],['M2','ม.2'],['M3','ม.3'],['M4','ม.4'],['M5','ม.5'],['M6','ม.6']] },
              { name: 'school', label: 'โรงเรียน', type: 'text', required: true, maxLength: 150, value: profile.school },
              { name: 'guardian_name', label: 'ชื่อ–นามสกุลผู้ปกครอง', type: 'text', required: true, maxLength: 120, value: profile.guardian_name },
              { name: 'guardian_phone', label: 'เบอร์โทรศัพท์ผู้ปกครอง', type: 'tel', required: true, maxLength: 24, value: profile.guardian_phone },
              { name: 'guardian_relationship', label: 'ความสัมพันธ์กับนักเรียน', type: 'select', required: true, value: profile.guardian_relationship, options: [['father','บิดา'],['mother','มารดา'],['guardian','ผู้ปกครอง'],['other','อื่น ๆ']] }
            ], 'ยืนยันสมัครเรียน', 'ข้อมูลผู้ปกครองใช้ติดต่อเรื่องการเรียน ผู้ดูแลและบัญชีนักเรียนของคุณเท่านั้นที่เปิดดูได้');
            if (!answer) return;
            await api('/api/student/enrollments', 'POST', { course_id: id, ...answer });
            message = 'สมัครเรียนแล้ว รอผู้ดูแลแจ้งยอดค่าเรียนในระบบ'; break;
          }
        case 'admin-profile':
          await adminProfileDialog(id); return;
        case 'edit-user': {
          const person = (state.data.users || []).find((item) => item.id === id);
          if (!person || person.role === 'admin') throw new Error('ไม่พบบัญชีที่แก้ไขได้');
          const answer = await fieldsDialog(`แก้ไขบัญชี ${personalCode(person)}`, [
            { name: 'name', label: 'ชื่อ–นามสกุล', type: 'text', required: true, maxLength: 120, value: person.name },
            { name: 'email', label: 'อีเมล', type: 'email', required: true, maxLength: 254, value: person.email }
          ], 'บันทึกบัญชี', 'รหัสประจำตัวจะคงเดิม การเปลี่ยนอีเมลมีผลต่อการแจ้งเตือนในครั้งถัดไป');
          if (!answer) return;
          await api(`/api/admin/users/${id}`, 'PUT', { name: answer.name.trim(), email: answer.email.trim() });
          message = 'แก้ไขชื่อและอีเมลแล้ว'; break;
        }
        case 'course-edit': {
          const course = (state.academic?.courses || []).find((item) => item.id === id);
          if (!course) throw new Error('ไม่พบคอร์ส');
          const teacherOptions = (state.data.users || [])
            .filter((person) => person.role === 'teacher' && (person.status === 'active' || person.id === course.teacher_id))
            .map((person) => [person.id, `${person.teacher_code || '—'} · ${person.name}`]);
          const answer = await fieldsDialog(`แก้ไขคอร์ส ${course.course_code}`, [
            { name: 'teacher_id', label: 'ครูประจำคอร์ส', type: 'select', required: true, value: course.teacher_id, options: teacherOptions },
            { name: 'capacity', label: 'จำนวนนักเรียนสูงสุด', type: 'number', required: true, value: course.capacity },
            { name: 'active', label: 'สถานะเปิดรับ', type: 'select', required: true, value: course.active ? 'true' : 'false', options: [['true', 'เปิดรับสมัคร'], ['false', 'ปิดรับสมัคร']] }
          ], 'บันทึกคอร์ส', 'รายวิชา ระดับ ราคา และรหัสคอร์สเป็นข้อมูลคงที่ การเปลี่ยนครูประจำคอร์สไม่แก้คาบที่จัดไว้แล้ว');
          if (!answer) return;
          await api(`/api/admin/courses/${id}`, 'PUT', {
            teacher_id: validId(answer.teacher_id), capacity: Number(answer.capacity), active: answer.active === 'true'
          });
          message = 'แก้ไขคอร์สแล้ว'; break;
        }
        case 'reset-user': {
          if (!confirm('รีเซ็ตรหัสผ่านและออกจากระบบทุกอุปกรณ์ของบัญชีนี้หรือไม่?')) return;
          const person = (state.data.users || []).find((item) => item.id === id);
          const result = await api(`/api/admin/users/${id}/reset-password`, 'POST', {});
          await load(); showCredential({ user: person, temporary_password: result.temporary_password });
          feedback('สร้างรหัสชั่วคราวแล้ว'); return;
        }
        case 'disable-user':
        case 'enable-user':
          if (!confirm(action === 'disable-user' ? 'ปิดบัญชีและออกจากระบบทุกอุปกรณ์หรือไม่?' : 'เปิดให้บัญชีนี้ใช้งานอีกครั้งหรือไม่?')) return;
          await api(`/api/admin/users/${id}/${action === 'disable-user' ? 'disable' : 'enable'}`, 'POST', {});
          message = action === 'disable-user' ? 'ปิดบัญชีแล้ว' : 'เปิดบัญชีแล้ว'; break;
        case 'roster':
          await rosterDialog(id); return;
        case 'payroll-detail':
          await payrollDetailDialog(id); return;
        case 'edit-invoice-amount': {
          const invoice = (state.data.invoices || []).find((item) => item.id === id);
          if (!invoice) throw new Error('ไม่พบใบแจ้งยอด');
          const answer = await fieldsDialog(`แก้ยอดใบแจ้งยอด ${invoice.invoice_number}`, [
            { name: 'amount', label: 'ค่าเรียนใหม่ (บาท)', type: 'text', required: true, value: (invoice.amount_satang / 100).toFixed(2) }
          ], 'บันทึกยอดใหม่', 'แก้ได้ก่อนมีการรับเงินหรือรายการแจ้งชำระที่รอตรวจ');
          if (!answer) return;
          await api(`/api/admin/invoices/${id}/amount`, 'POST', { amount_satang: toSatang(answer.amount) });
          message = 'แก้ยอดค่าเรียนแล้ว'; break;
        }
        case 'edit-invoice-due-date': {
          const invoice = (state.data.invoices || []).find((item) => item.id === id);
          if (!invoice) throw new Error('ไม่พบใบแจ้งยอด');
          const answer = await fieldsDialog(`เปลี่ยนวันครบกำหนด ${invoice.invoice_number}`, [
            { name: 'due_date', label: 'วันครบกำหนดใหม่', type: 'date', required: true, value: invoice.due_date }
          ], 'บันทึกวันครบกำหนด');
          if (!answer) return;
          await api(`/api/admin/invoices/${id}/due-date`, 'POST', { due_date: answer.due_date });
          message = 'เปลี่ยนวันครบกำหนดแล้ว'; break;
        }
        case 'void-invoice':
          if (!confirm('ยกเลิกใบแจ้งยอดนี้หรือไม่? นักเรียนจะไม่ต้องชำระใบนี้แล้ว')) return;
          await api(`/api/admin/invoices/${id}/void`, 'POST', {});
          message = 'ยกเลิกใบแจ้งยอดแล้ว'; break;
        case 'restore-invoice':
          if (!confirm('คืนสถานะใบแจ้งยอดนี้และแจ้งนักเรียนอีกครั้งหรือไม่?')) return;
          await api(`/api/admin/invoices/${id}/restore`, 'POST', {});
          message = 'คืนสถานะใบแจ้งยอดแล้ว'; break;
        case 'approve-claim':
          if (!confirm('ตรวจสอบยอดเงินจริงและเลขอ้างอิงแล้วใช่หรือไม่?')) return;
          await api(`/api/admin/payment-claims/${id}/approve`, 'POST', {}); message = 'ยืนยันรับเงินแล้ว'; break;
        case 'reject-claim':
          if (!confirm('ปฏิเสธรายการแจ้งชำระนี้หรือไม่?')) return;
          await api(`/api/admin/payment-claims/${id}/reject`, 'POST', {}); message = 'ปฏิเสธรายการแจ้งชำระแล้ว'; break;
        case 'approve-time':
          await api(`/api/admin/time-entries/${id}/approve`, 'POST', {}); message = 'อนุมัติเวลาสอนและคำนวณค่าจ้างแล้ว'; break;
        case 'override-time': {
          const answer = await fieldsDialog('อนุมัติยอดพิเศษรายคาบ', [
            { name: 'amount', label: 'ยอดค่าจ้างคาบนี้ (บาท)', type: 'text', required: true },
            { name: 'reason', label: 'เหตุผลที่ไม่ใช้อัตราปกติ', type: 'text', required: true, maxLength: 250 },
            { name: 'source_reference', label: 'เอกสารหรือแถวในชีตอ้างอิง', type: 'text', required: true, maxLength: 120 }
          ], 'อนุมัติยอดพิเศษ');
          if (!answer) return;
          await api(`/api/admin/time-entries/${id}/approve-override`, 'POST', {
            amount_satang: toSatang(answer.amount), reason: answer.reason.trim(), source_reference: answer.source_reference.trim()
          });
          message = 'อนุมัติยอดพิเศษพร้อมบันทึกเหตุผลแล้ว'; break;
        }
        case 'reject-time': {
          const answer = await fieldsDialog('ปฏิเสธเวลาสอน', [{ name: 'reason', label: 'เหตุผล', type: 'text', required: true, maxLength: 250 }], 'ยืนยันการปฏิเสธ');
          if (!answer) return;
          await api(`/api/admin/time-entries/${id}/reject`, 'POST', { reason: answer.reason.trim() }); message = 'ปฏิเสธเวลาสอนแล้ว'; break;
        }
        case 'confirm-rate': {
          const rule = (state.data.rates || []).find((item) => item.id === id);
          const teachers = (state.data.staff || []).filter((person) => person.role === 'teacher' && person.status === 'active');
          const answer = await fieldsDialog(`ยืนยันอัตรา ${rule?.teacher_label || ''}`, [
            { name: 'teacher_id', label: 'จับคู่กับบัญชีครู', type: 'select', required: true, options: teachers.map((person) => [person.id, `${person.name} · ${person.email}`]) },
            { name: 'effective_from', label: 'วันที่เริ่มใช้', type: 'date', required: true }
          ], 'ยืนยันอัตรานี้');
          if (!answer) return;
          const teacher = teachers.find((person) => person.id === answer.teacher_id);
          const payload = { teacher_id: validId(answer.teacher_id), effective_from: answer.effective_from };
          if (teacher && teacher.name.trim().toLocaleLowerCase() !== String(rule?.teacher_label || '').trim().toLocaleLowerCase()) {
            const mismatch = await fieldsDialog('ชื่อครูในชีตไม่ตรงกับบัญชี', [
              { name: 'reason', label: 'เหตุผล/หลักฐานที่ยืนยันว่าเป็นคนเดียวกัน', type: 'text', required: true, maxLength: 250 }
            ], 'ยืนยันการจับคู่');
            if (!mismatch) return;
            payload.confirm_name_mismatch = true;
            payload.reason = mismatch.reason.trim();
          }
          await api(`/api/admin/rates/${id}/confirm`, 'POST', payload);
          message = 'ยืนยันอัตราค่าจ้างแล้ว'; break;
        }
        case 'end-rate': {
          const answer = await fieldsDialog('สิ้นสุดอัตราค่าจ้าง', [{ name: 'effective_to', label: 'วันที่สิ้นสุดการใช้', type: 'date', required: true }], 'บันทึกวันสิ้นสุด');
          if (!answer) return;
          await api(`/api/admin/rates/${id}/end`, 'POST', { effective_to: answer.effective_to });
          message = 'บันทึกวันสิ้นสุดอัตราแล้ว'; break;
        }
        case 'adjust-payroll': {
          const answer = await fieldsDialog('ปรับยอดงวดค่าจ้าง', [
            { name: 'amount', label: 'จำนวนเงินเพิ่ม/ลด (บาท; ใส่ - หากลด)', type: 'text', required: true },
            { name: 'reason', label: 'เหตุผล', type: 'text', required: true, maxLength: 250 }
          ], 'บันทึกการปรับยอด');
          if (!answer) return;
          await api(`/api/admin/payroll-runs/${id}/adjustments`, 'POST', { amount_satang: toSatang(answer.amount, true), reason: answer.reason.trim() });
          message = 'ปรับยอดงวดแล้ว'; break;
        }
        case 'finalize-payroll':
          if (!confirm('ตรวจยอดและต้องการปิดงวดนี้หรือไม่? หลังปิดงวดจะแก้ไม่ได้')) return;
          await api(`/api/admin/payroll-runs/${id}/finalize`, 'POST', {}); message = 'ปิดงวดค่าจ้างแล้ว'; break;
        case 'cancel-payroll':
          if (!confirm('ยกเลิกงวดร่างนี้หรือไม่? รายการเวลาสอนที่อนุมัติจะกลับไปสร้างงวดใหม่ได้')) return;
          await api(`/api/admin/payroll-runs/${id}/cancel`, 'POST', {}); message = 'ยกเลิกงวดร่างแล้ว'; break;
        case 'pay-payroll': {
          const answer = await fieldsDialog('บันทึกการจ่ายค่าจ้าง', [{ name: 'reference', label: 'เลขอ้างอิงการโอน', type: 'text', required: true, maxLength: 120 }], 'ยืนยันว่าจ่ายแล้ว');
          if (!answer) return;
          await api(`/api/admin/payroll-runs/${id}/mark-paid`, 'POST', { reference: answer.reference.trim() });
          message = 'บันทึกว่าจ่ายค่าจ้างแล้ว'; break;
        }
        default: throw new Error('ยังไม่รองรับการดำเนินการนี้');
      }
      await load();
      feedback(message);
    });
  }

  function fieldsDialog(title, fields, submitText, note = '') {
    const dialog = $('live-dialog');
    dialog.replaceChildren();
    const form = element('form', 'live-form');
    const heading = element('h2', '', title);
    form.append(heading);
    if (note) form.append(element('p', 'muted', note));
    for (const field of fields) {
      const label = element('label', '', field.label);
      let input;
      if (field.type === 'select') {
        input = element('select'); option(input, '', 'เลือกข้อมูล');
        for (const [value, name] of field.options || []) option(input, value, name);
      } else {
        input = element('input'); input.type = field.type || 'text';
        if (field.maxLength) input.maxLength = field.maxLength;
      }
      input.name = field.name; input.required = Boolean(field.required); label.append(input); form.append(label);
      if (field.value) input.value = field.value;
    }
    const actions = element('div', 'actions');
    const cancel = element('button', '', 'ยกเลิก'); cancel.type = 'button';
    const save = element('button', 'primary', submitText); save.type = 'submit';
    actions.append(cancel, save); form.append(actions); dialog.append(form);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      cancel.onclick = () => dialog.close();
      form.onsubmit = (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)); dialog.close(); finish(values); };
      dialog.onclose = () => { dialog.replaceChildren(); finish(null); };
      dialog.showModal();
    });
  }

  function classDetailDialog(classId) {
    const classroom = state.classes.find((item) => item.id === classId);
    if (!classroom) throw new Error('ไม่พบห้องเรียน');
    const dialog = $('live-dialog'); dialog.replaceChildren(); dialog.classList.add('class-dialog');
    dialog.append(element('h2', '', `${classroom.room_name} · ${classroom.course_title}`));
    dialog.append(element('p', 'muted', `${classroom.course_code || '—'} · ${classSummary(classroom)}`));
    dialog.append(element('p', '', `ผู้สอน ${classroom.teacher_code || '—'} · ${classroom.teacher_name || '—'} · ${status(classroom.status)}`));
    dialog.append(element('h3', '', `นักเรียนในห้อง (${classroom.roster_count ?? classroom.students?.length ?? 0} คน)`));
    const wrap = element('div', 'tablewrap'); const table = element('table');
    const head = element('thead'); const headerRow = element('tr');
    for (const label of ['รหัสนักเรียน', 'ชื่อ', 'การเข้าเรียน']) headerRow.append(element('th', '', label));
    head.append(headerRow); table.append(head);
    const body = element('tbody');
    if (!(classroom.students || []).length) emptyRow(body, 3, 'ยังไม่ได้จัดนักเรียนเข้าห้อง');
    for (const person of classroom.students || []) {
      const row = element('tr');
      cell(row, person.student_code || '—', 'record-code');
      cell(row, person.name);
      cell(row, person.attendance_status === 'present' ? 'มาเรียน' : person.attendance_status === 'absent' ? 'ขาดเรียน' : 'ยังไม่เช็กชื่อ');
      body.append(row);
    }
    table.append(body); wrap.append(table); dialog.append(wrap);
    const close = element('button', 'primary class-dialog-close', 'ปิด'); close.type = 'button';
    close.onclick = () => dialog.close(); dialog.append(close);
    dialog.onclose = () => { dialog.classList.remove('class-dialog'); dialog.replaceChildren(); };
    dialog.showModal();
  }

  function classEditDialog(classId) {
    const classroom = state.classes.find((item) => item.id === classId);
    if (!classroom) throw new Error('ไม่พบห้องเรียน');
    const dialog = $('live-dialog'); dialog.replaceChildren(); dialog.classList.add('class-dialog');
    const form = element('form', 'live-form');
    form.append(element('h2', '', 'แก้ไขห้องเรียน'));
    form.append(element('p', 'muted', 'ผู้ดูแลเป็นผู้เลือกคอร์ส ครู ห้อง เวลา และนักเรียนทุกคนด้วยตนเอง'));
    const addField = (labelText, name, type, value = '') => {
      const label = element('label', '', labelText);
      const input = element(type === 'select' ? 'select' : 'input');
      if (type !== 'select') input.type = type;
      input.name = name; input.required = true; input.value = value;
      label.append(input); form.append(label); return input;
    };
    const courseInput = addField('คอร์ส / รหัสวิชา', 'course_id', 'select');
    for (const course of state.academic?.courses || []) {
      if (course.active || course.id === classroom.course_id) option(courseInput, course.id, `${course.course_code || '—'} · ${course.title}`);
    }
    courseInput.value = classroom.course_id;
    const teacherInput = addField('ครูผู้สอน', 'teacher_id', 'select');
    for (const teacher of state.data.users || []) {
      if (teacher.role === 'teacher' && (teacher.status === 'active' || teacher.id === classroom.teacher_id)) option(teacherInput, teacher.id, `${teacher.teacher_code || '—'} · ${teacher.name}`);
    }
    teacherInput.value = classroom.teacher_id;
    const roomInput = addField('ชื่อห้อง', 'room_name', 'text', classroom.room_name); roomInput.maxLength = 80;
    const startInput = addField('เริ่มเรียน (เวลาไทย)', 'starts_at', 'datetime-local', bangkokInput(epochValue(classroom.starts_at)));
    const endInput = addField('เลิกเรียน (เวลาไทย)', 'ends_at', 'datetime-local', bangkokInput(epochValue(classroom.ends_at)));
    const fieldset = element('fieldset', 'class-roster-field');
    fieldset.append(element('legend', '', 'นักเรียนในห้อง'));
    const picker = element('div', 'class-student-picker');
    fieldset.append(picker); form.append(fieldset);
    const currentIds = (classroom.students || []).map((person) => person.id);
    fillClassStudentPicker(classroom.course_id, currentIds, picker);
    courseInput.addEventListener('change', () => {
      const course = (state.academic?.courses || []).find((item) => item.id === courseInput.value);
      teacherInput.value = course?.teacher_id || '';
      fillClassStudentPicker(courseInput.value, courseInput.value === classroom.course_id ? currentIds : [], picker);
    });
    const actions = element('div', 'actions');
    const cancel = element('button', '', 'ยกเลิก'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    const save = element('button', 'primary', 'บันทึกห้องเรียน'); save.type = 'submit';
    actions.append(cancel, save); form.append(actions);
    const notice = element('p', 'live-modal-feedback'); notice.setAttribute('role', 'alert'); form.append(notice);
    dialog.append(form);
    form.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true; notice.textContent = '';
      try {
        await api(`/api/admin/classes/${classId}`, 'PUT', {
          course_id: validId(courseInput.value), teacher_id: validId(teacherInput.value), room_name: roomInput.value.trim(),
          starts_at: bangkokISO(startInput.value), ends_at: bangkokISO(endInput.value), student_ids: chosenStudentIds(form)
        });
        dialog.close(); await load(); feedback('บันทึกห้องเรียนและรายชื่อแล้ว');
      } catch (error) { notice.textContent = error.message || 'บันทึกไม่สำเร็จ'; save.disabled = false; }
    };
    dialog.onclose = () => { dialog.classList.remove('class-dialog'); dialog.replaceChildren(); };
    dialog.showModal();
  }

  async function adminProfileDialog(studentId) {
    const details = await api(`/api/admin/students/${studentId}/profile`);
    const profile = details.profile || {};
    const answer = await fieldsDialog(`ข้อมูลนักเรียน · ${details.student.name}`, [
      { name: 'grade', label: 'ระดับชั้น', type: 'select', required: true, value: profile.grade, options: [['M1','ม.1'],['M2','ม.2'],['M3','ม.3'],['M4','ม.4'],['M5','ม.5'],['M6','ม.6']] },
      { name: 'school', label: 'โรงเรียน', type: 'text', required: true, maxLength: 150, value: profile.school },
      { name: 'guardian_name', label: 'ชื่อ–นามสกุลผู้ปกครอง', type: 'text', required: true, maxLength: 120, value: profile.guardian_name },
      { name: 'guardian_phone', label: 'เบอร์โทรศัพท์ผู้ปกครอง', type: 'tel', required: true, maxLength: 24, value: profile.guardian_phone },
      { name: 'guardian_relationship', label: 'ความสัมพันธ์กับนักเรียน', type: 'select', required: true, value: profile.guardian_relationship, options: [['father','บิดา'],['mother','มารดา'],['guardian','ผู้ปกครอง'],['other','อื่น ๆ']] }
    ], 'บันทึกข้อมูล', 'ข้อมูลติดต่อผู้ปกครองเป็นข้อมูลส่วนตัว กรุณาเปิดดูเฉพาะเมื่อจำเป็น');
    if (!answer) return;
    await api(`/api/admin/students/${studentId}/profile`, 'PUT', answer);
    feedback('บันทึกข้อมูลนักเรียนแล้ว');
  }

  function showCredential(created) {
    const dialog = $('live-dialog');
    dialog.replaceChildren();
    dialog.append(element('h2', '', 'สร้างรหัสผ่านชั่วคราวแล้ว'));
    dialog.append(element('p', 'muted', `${personalCode(created.user)} · ${created.user.name} · ${created.user.email}`));
    dialog.append(element('p', '', 'รหัสผ่านชั่วคราว (แสดงครั้งเดียว):'));
    const secret = element('input', 'temporary-secret'); secret.value = created.temporary_password; secret.readOnly = true; secret.setAttribute('aria-label', 'รหัสผ่านชั่วคราว');
    dialog.append(secret);
    const copy = element('button', '', 'คัดลอกรหัสผ่าน'); copy.type = 'button';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(secret.value); copy.textContent = 'คัดลอกแล้ว'; }
      catch { secret.focus(); secret.select(); copy.textContent = 'เลือกรหัสแล้ว กดคัดลอกด้วยตนเอง'; }
    };
    dialog.append(copy);
    dialog.append(element('p', 'foot', 'สำคัญ: รหัสนี้แสดงครั้งเดียว ส่งให้เจ้าของบัญชีด้วยช่องทางที่ปลอดภัย และผู้ใช้ต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก'));
    const close = element('button', 'primary', 'ปิด'); close.type = 'button'; close.onclick = () => dialog.close(); dialog.append(close);
    dialog.onclose = () => { secret.value = ''; dialog.replaceChildren(); };
    dialog.showModal();
  }

  async function rosterDialog(sessionId) {
    let roster;
    try {
      roster = await api(`/api/${state.me.role}/sessions/${sessionId}/roster`);
    } catch (error) {
      if (error.status === 404) throw new Error('ระบบเช็กชื่อยังไม่เปิดในรุ่นนี้ กรุณาให้ผู้ดูแลเพิ่มบริการรายชื่อนักเรียนก่อนอนุมัติเวลา');
      throw error;
    }
    const students = roster.students || roster.roster || [];
    const dialog = $('live-dialog'); dialog.replaceChildren();
    const form = element('form', 'live-form'); form.append(element('h2', '', 'เช็กชื่อนักเรียน'));
    if (!students.length) form.append(element('p', 'muted', 'ยังไม่มีนักเรียนในคอร์สนี้'));
    const list = element('div', 'roster-list');
    for (const student of students) {
      const studentId = student.student_id || student.id;
      if (!/^[0-9a-f]{32}$/.test(String(studentId))) continue;
      const label = element('label', 'roster-item', `${student.student_code ? `${student.student_code} · ` : ''}${student.name || student.student_name || student.email || studentId}`);
      const select = element('select'); select.dataset.studentId = studentId; select.required = true;
      option(select, '', 'เลือกสถานะ'); option(select, 'present', 'เข้าเรียน'); option(select, 'absent', 'ขาดเรียน');
      const current = student.attendance_status || student.attendance || student.status;
      select.value = current === 'absent' || current === 'present' ? current : '';
      label.append(select); list.append(label);
    }
    form.append(list);
    const actions = element('div', 'actions'); const cancel = element('button', '', 'ยกเลิก'); cancel.type = 'button';
    const save = element('button', 'primary', 'บันทึกเช็กชื่อ'); save.type = 'submit'; save.disabled = !list.children.length;
    actions.append(cancel, save); form.append(actions); dialog.append(form);
    cancel.onclick = () => dialog.close();
    form.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true;
      try {
        const records = [...list.querySelectorAll('select')].map((select) => ({ student_id: select.dataset.studentId, status: select.value }));
        await api(`/api/${state.me.role}/sessions/${sessionId}/attendance`, 'PUT', { records });
        dialog.close(); await load(); feedback('บันทึกเช็กชื่อแล้ว');
      } catch (error) { feedback(error.message || 'บันทึกเช็กชื่อไม่สำเร็จ', true); save.disabled = false; }
    };
    dialog.onclose = () => dialog.replaceChildren();
    dialog.showModal();
  }

  async function payrollDetailDialog(runId) {
    const role = state.me.role;
    const detail = await api(`/api/${role}/payroll-runs/${runId}`);
    const run = detail.run;
    const dialog = $('live-dialog'); dialog.replaceChildren();
    dialog.append(element('h2', '', `งวด ${run.period} · ${run.teacher_name}`));
    dialog.append(element('p', 'muted', `สถานะ ${status(run.status)} · ยอดรวม ${thaiMoney(run.total_satang)}`));
    const wrap = element('div', 'tablewrap'); const table = element('table');
    const head = element('thead'); const headRow = element('tr');
    for (const label of ['วันที่ / คอร์ส', 'เวลาสอน', 'อัตรา/ที่มา', 'ยอด']) headRow.append(element('th', '', label));
    head.append(headRow); table.append(head);
    const body = element('tbody');
    for (const line of detail.lines || []) {
      const row = element('tr'); const course = cell(row, line.course_title); course.append(element('div', 'muted', thaiDateTime(line.starts_at)));
      cell(row, hours(line.minutes));
      const rule = line.pricing_type === 'manual_amount' ? 'ยอดพิเศษ' : `${thaiMoney(line.rate_satang_per_hour)} / ชม.`;
      const source = cell(row, rule);
      if (line.override_reference) source.append(element('div', 'muted', `อ้างอิง: ${line.override_reference}`));
      if (line.override_reason) source.append(element('div', 'muted', line.override_reason));
      cell(row, thaiMoney(line.amount_satang)); body.append(row);
    }
    if (!(detail.lines || []).length) emptyRow(body, 4, 'ไม่มีรายการในงวดนี้');
    table.append(body); wrap.append(table); dialog.append(wrap);
    if ((detail.adjustments || []).length) {
      dialog.append(element('h3', '', 'รายการปรับยอด'));
      for (const adjustment of detail.adjustments) dialog.append(element('p', 'foot', `${thaiMoney(adjustment.amount_satang)} · ${adjustment.reason}`));
    }
    if (run.payment_reference) dialog.append(element('p', 'foot', `อ้างอิงการจ่าย: ${run.payment_reference}`));
    const close = element('button', 'primary', 'ปิด'); close.type = 'button'; close.onclick = () => dialog.close(); dialog.append(close);
    dialog.onclose = () => dialog.replaceChildren();
    dialog.showModal();
  }

  function passwordDialog(forced) {
    const dialog = $('live-dialog'); dialog.replaceChildren();
    const form = element('form', 'live-form');
    form.append(element('h2', '', forced ? 'เปลี่ยนรหัสผ่านชั่วคราว' : 'เปลี่ยนรหัสผ่าน'));
    form.append(element('p', 'muted', forced ? 'ต้องตั้งรหัสผ่านใหม่ก่อนใช้งานบัญชีนี้' : 'หลังเปลี่ยนรหัส ระบบจะให้เข้าสู่ระบบอีกครั้ง'));
    for (const [name, label] of [['current_password', 'รหัสผ่านปัจจุบัน'], ['new_password', 'รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)']]) {
      const wrapper = element('div', 'password-row');
      const inputLabel = element('label', '', label);
      const field = element('div', 'password-entry');
      const input = element('input');
      input.id = `password-${name}`;
      inputLabel.htmlFor = input.id;
      input.type = 'password'; input.name = name; input.required = true;
      input.minLength = name === 'new_password' ? 12 : 1;
      input.autocomplete = name === 'new_password' ? 'new-password' : 'current-password';
      const toggle = element('button', 'password-reveal');
      toggle.type = 'button';
      toggle.setAttribute('aria-controls', input.id);
      toggle.setAttribute('aria-label', `แสดง${label}`);
      toggle.setAttribute('aria-pressed', 'false');
      toggle.append(eyeIcon());
      toggle.onclick = () => {
        const shown = input.type === 'password';
        input.type = shown ? 'text' : 'password';
        toggle.setAttribute('aria-label', `${shown ? 'ซ่อน' : 'แสดง'}${label}`);
        toggle.setAttribute('aria-pressed', String(shown));
      };
      field.append(input, toggle); wrapper.append(inputLabel, field); form.append(wrapper);
    }
    const actions = element('div', 'actions');
    if (!forced) { const cancel = element('button', '', 'ยกเลิก'); cancel.type = 'button'; cancel.onclick = () => dialog.close(); actions.append(cancel); }
    const save = element('button', 'primary', 'บันทึกรหัสผ่านใหม่'); save.type = 'submit'; actions.append(save); form.append(actions);
    const notice = element('p', 'live-modal-feedback'); notice.setAttribute('role', 'alert'); form.append(notice); dialog.append(form);
    form.onsubmit = async (event) => {
      event.preventDefault(); save.disabled = true; notice.textContent = '';
      try {
        await api('/api/auth/change-password', 'POST', Object.fromEntries(new FormData(form)));
        location.replace('index.html');
      } catch (error) { notice.textContent = error.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ'; save.disabled = false; }
    };
    if (forced) dialog.addEventListener('cancel', (event) => event.preventDefault(), { once: true });
    dialog.onclose = () => { if (forced) passwordDialog(true); else dialog.replaceChildren(); };
    dialog.showModal();
  }

  async function start() {
    document.body.innerHTML = '<main class="live-loading"><img src="physics-house-logo-yellow-black.png" alt="Physics House"><p>กำลังตรวจสอบบัญชี…</p></main>';
    document.body.classList.add('live-ready');
    try {
      const me = await api('/api/me');
      if (!me.authenticated || !me.user) { location.replace('index.html'); return; }
      if (!roleNames[me.user.role]) throw new Error('บทบาทบัญชีไม่ถูกต้อง');
      state.me = me.user; state.csrf = me.csrf_token;
      shell(me.user);
      if (me.user.must_change_password) {
        $('live-content').append(element('section', 'panel', 'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน'));
        passwordDialog(true); return;
      }
      await load();
    } catch (error) {
      document.body.innerHTML = '';
      const main = element('main', 'live-loading');
      main.append(element('h1', '', 'เปิดระบบไม่ได้'), element('p', '', error.message || 'กรุณาลองใหม่'));
      const retry = element('button', 'primary', 'ลองอีกครั้ง'); retry.onclick = () => location.reload(); main.append(retry);
      document.body.append(main);
    }
  }
  start();
})();
