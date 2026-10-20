# นำ Physics Plus ขึ้น Vercel

แพ็กเกจนี้จัดหน้า login และไฟล์ภาพ/สไตล์ไว้ใน `public/` ส่วน `private/dashboard.html` ให้ Flask ที่ `app.py` ระดับรากโปรเจกต์ตรวจเซสชันก่อนส่งหน้า ข้อมูลบัญชี นักเรียน การเงิน และค่าจ้างอยู่ในฐานข้อมูล Turso ระยะไกล ไม่ใช้ไฟล์ SQLite ใน Vercel ไฟล์ในแพ็กเกจไม่มีฐานข้อมูลจริงหรือรหัสผ่าน

**สถานะ ณ 20 ต.ค. 2026:** ฐานข้อมูล Turso Cloud แผน Starter แยกสำหรับ **Production** และ **Preview** แล้ว โดย integration ให้ `TURSO_DATABASE_URL` และ `TURSO_AUTH_TOKEN` ของแต่ละ environment เป็นค่า Sensitive ฐานข้อมูลใช้ URL แบบ libSQL (`libsql://...`) และโค้ดรองรับด้วย `libsql` บน Python การรัน `manage.py init` และ `manage.py check` กับทั้งสองฐานผ่านแล้ว: schema พร้อม, ผู้ดูแลที่ active ฐานละ 1 บัญชี และเรทกลางตรง 8 ช่วง Production ผ่านการตรวจ `/api/health`, การล็อกอินผู้ดูแล, หน้าแดชบอร์ดที่ป้องกันไว้ และการออกจากระบบ Preview ใช้บัญชีทดสอบคนละรหัสกับ Production และทดสอบล็อกอิน/แดชบอร์ดจริงแล้ว ทั้งสองฐานเปิด Delete Protection ส่วน Gmail ผู้ส่ง, การซิงก์ Google Sheet อัตโนมัติ, การยืนยันอีเมล, MFA และนโยบายข้อมูลเด็กยังไม่ครบ จึงไม่ควรถือว่าระบบพร้อมรับข้อมูลนักเรียนจริงทุกกรณี

## 1. เตรียมบัญชีและฐานข้อมูล

ต้องมีบัญชี Vercel และสิทธิ์จัดการ Turso Cloud integration ใช้ Python 3.12 หรือใหม่กว่าและติดตั้งแพ็กเกจจาก `requirements.txt` บนเครื่องที่ใช้รันคำสั่งจัดการฐานข้อมูล ตรวจว่าล็อกอิน Vercel CLI กับบัญชีและทีมที่ต้องการก่อนดำเนินการ

สำหรับโปรเจกต์ใหม่ ให้สร้าง Vercel Project ตามข้อ 2 แล้วเปิด Vercel Marketplace → Turso Cloud เลือกแผน Starter หรือแผนที่เหมาะสม สร้างฐานข้อมูลและเชื่อมทรัพยากรกับ environment **Production** ของโปรเจกต์ ตรวจว่ามีตัวแปรชื่อ `TURSO_DATABASE_URL` และ `TURSO_AUTH_TOKEN` โดยไม่แสดงค่าลับ ฐานข้อมูลที่เชื่อมผ่าน Marketplace ในขั้นตอนนี้ใช้ libSQL; คำสั่งเก่าที่สร้างฐานข้อมูลด้วย `turso db create --tursodb` ใช้คนละ engine และไม่ใช่ขั้นตอนสำหรับทรัพยากรนี้

สร้างฐานข้อมูล **Preview แยกต่างหาก** ผ่าน Turso Cloud และเชื่อมกับ environment Preview เท่านั้น โดยให้ URL และ token ต่างจาก Production ตรวจว่ามีการสำรองข้อมูลและวิธีกู้คืนในบัญชี Turso ก่อนเริ่ม migration ห้ามใส่ token ลงในไฟล์นี้, `.env.example`, Git, คำสั่งที่บันทึกประวัติ shell หรือแชต

## 2. ผูกโปรเจกต์ Vercel และตั้งค่าลับ

สร้างโปรเจกต์ Vercel สำหรับร้าน โดยให้ **Root Directory** ชี้ไปยังโฟลเดอร์ที่มี `app.py`, `requirements.txt` และ `vercel.json` สำหรับ repository `Physics-Plus-Website` ไฟล์เหล่านี้อยู่ที่ราก repository จึงให้เว้นค่า Root Directory ว่าง (หรือใช้ `.`) หากนำโฟลเดอร์ `physics-plus-vercel` ไปไว้ภายใน repository อื่น จึงตั้ง Root Directory เป็นชื่อโฟลเดอร์นั้น จากนั้นรันจากโฟลเดอร์โปรเจกต์:

```bash
vercel whoami
vercel link
```

ตรวจชื่อทีม/โปรเจกต์ที่ CLI แสดงก่อนดำเนินการ สำหรับโปรเจกต์นี้ Turso Cloud integration เชื่อมฐานข้อมูลกับ **Production** แล้ว; สำหรับโปรเจกต์ใหม่ให้เชื่อมตามข้อ 1 ตรวจชื่อ environment variables ใน Vercel Project Settings → Environment Variables และตั้งค่าที่เหลือ:

| ชื่อ | ค่า | การเก็บ |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | URL แบบ `libsql://...` ของฐานข้อมูล Production ที่ Turso Cloud integration เชื่อมให้ | **Sensitive**; ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `TURSO_AUTH_TOKEN` | token ของฐานข้อมูล Production ที่ Turso Cloud integration เชื่อมให้ | **Sensitive**; ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `PH_PUBLIC_ORIGIN` | `https://โดเมนจริงของร้าน` ถ้ามี custom domain | exact HTTPS origin; ไม่ใส่เครื่องหมาย `/` ปิดท้าย |
| `PH_GMAIL_USER` | ที่อยู่ Gmail เต็มของร้านที่ใช้ส่ง เช่น `yourshop@gmail.com` | ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `PH_GMAIL_APP_PASSWORD` | App Password 16 ตัวอักษรที่สร้างในบัญชี Google หลังเปิด 2-Step Verification; **ไม่ใช่รหัสผ่าน Gmail ปกติ** | **Sensitive**; ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `RESEND_API_KEY` | ตัวเลือกสำรอง: API key ของ Resend หลังตรวจยืนยันโดเมนผู้ส่ง | **Sensitive**; ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `PH_EMAIL_FROM` | ตัวเลือกสำรอง: อีเมลผู้ส่งบนโดเมนที่ตรวจยืนยันกับ Resend | ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `PH_ADMIN_NOTIFICATION_EMAIL` | อีเมลผู้ดูแลที่ต้องการรับการแจ้งเตือน | ฝั่งเซิร์ฟเวอร์เท่านั้น |
| `CRON_SECRET` | ค่าสุ่มอย่างน้อย 32 ตัวอักษรสำหรับป้องกัน endpoint ส่งอีเมลค้าง | **Secret**; ฝั่งเซิร์ฟเวอร์เท่านั้น |

`PH_PUBLIC_ORIGIN` เป็นตัวเลือกเมื่อรันบน Vercel: ถ้าไม่มี custom domain ระบบใช้ origin จาก `VERCEL_URL` ที่ Vercel กำหนดไว้ ช่วง Preview รับเฉพาะ URL ของ deployment/branch ที่ Vercel กำหนด ไม่เปิด wildcard ให้โดเมนอื่น โค้ดฝั่ง browser ต้องไม่เห็น `TURSO_AUTH_TOKEN` และห้ามใช้ prefix `NEXT_PUBLIC_` หรือ `VITE_` กับ token

ใน Vercel Project → Environment Variables ให้เปิด **Enable access to System Environment Variables** เพื่อให้ `VERCEL`, `VERCEL_URL` และ `VERCEL_BRANCH_URL` มีค่าใน runtime หากไม่เปิด ต้องตั้ง `PH_PUBLIC_ORIGIN` เป็น HTTPS origin ที่ตรงกับโดเมนที่ใช้จริง มิฉะนั้น API จะปฏิเสธการทำงาน การเปิดค่านี้จำเป็นสำหรับการทดสอบบน Preview URL โดยไม่มีโดเมนกำหนดเอง

สำหรับ Preview ให้เชื่อมฐานข้อมูล Turso Cloud อีกฐานกับ environment **Preview** แล้วตรวจว่ามี `TURSO_DATABASE_URL` และ `TURSO_AUTH_TOKEN` ของฐานนั้นโดยเฉพาะ เพื่อไม่ให้บัญชีทดสอบหรือข้อมูลจำลองปะปนกับข้อมูลจริง ไม่ต้องตั้ง `PH_PUBLIC_ORIGIN` สำหรับ Preview เมื่อใช้ URL ที่ Vercel สร้าง อย่าตั้งค่า Preview ให้ชี้ฐานข้อมูล Production

สำหรับร้านที่ใช้ Gmail ปกติ ให้เปิด 2-Step Verification ในบัญชี Google ของร้าน สร้าง App Password เฉพาะเว็บนี้ แล้วตั้ง `PH_GMAIL_USER` กับ `PH_GMAIL_APP_PASSWORD` ใน Vercel Production; ตั้ง `PH_ADMIN_NOTIFICATION_EMAIL` ด้วยเพื่อรับการแจ้งผู้ดูแล ไม่ต้องมีโดเมนผู้ส่งแยกเมื่อส่งจาก Gmail นี้ หากบัญชีไม่อนุญาตให้สร้าง App Password ต้องเลือกวิธียืนยันตัวตนหรือผู้ให้บริการส่งอีเมลอื่น การเปลี่ยนรหัสบัญชี Google อาจทำให้ App Password ถูกยกเลิก ต้องสร้างใหม่และ redeploy ห้ามใส่รหัสผ่านบัญชี Google ปกติหรือ App Password ใน Git, frontend หรือแชต

ระบบใช้ `smtp.gmail.com:465` ผ่าน SSL/TLS พร้อมตรวจใบรับรองและ timeout; [Vercel อนุญาตพอร์ต SMTP 465](https://vercel.com/kb/guide/serverless-functions-and-smtp) แต่ต้องทดสอบการเชื่อมต่อจริงหลัง deploy หากกำหนด Gmail และ Resend ครบทั้งสองชุด จะเลือก Gmail ก่อน; หากไม่มี Gmail ครบคู่จึงใช้ Resend ซึ่งต้องมี `RESEND_API_KEY` และ `PH_EMAIL_FROM` จากโดเมนที่ยืนยันแล้ว ระบบไม่สลับไปอีกผู้ให้บริการหลังส่งล้มเหลว เพราะผล SMTP บางกรณีไม่ชัดว่าเซิร์ฟเวอร์รับข้อความแล้วหรือยัง

ข้อความอีเมลบอกเพียงว่ามีข้อมูลอัปเดตและให้กลับมาเข้าเว็บไซต์เอง ไม่ใส่ชื่อเด็ก ข้อมูลผู้ปกครอง จำนวนเงิน หรือเลขอ้างอิง ธุรกรรมหลักบันทึกลงฐานข้อมูลก่อน; อีเมลที่ส่งไม่สำเร็จอยู่ใน outbox เพื่อส่งซ้ำแบบจำกัดครั้งด้วย Cron ถ้ายังไม่ตั้งค่าผู้ส่ง ระบบทำงานด้านข้อมูลได้ แต่ **จะยังไม่มีอีเมลส่งจริง** บัญชี Vercel Hobby รัน Cron ได้วันละครั้ง จึงอาจส่งอีเมลที่ต้องลองซ้ำในวันถัดไป SMTP ไม่มีคีย์ป้องกันการส่งซ้ำแบบ Resend; เมื่อการตอบรับไม่ชัดเจน การส่งซ้ำอาจทำให้ได้รับอีเมลแจ้งทั่วไปซ้ำ ผู้ดูแลตรวจจำนวนค้าง/ส่งไม่สำเร็จได้ในหน้าแดชบอร์ด

## 3. สร้างตารางและผู้ดูแลคนแรก

รัน migration และ bootstrap **จากเครื่องที่เชื่อถือได้** หลังยืนยันว่าโค้ดและไดรเวอร์ Python เชื่อมฐานข้อมูล libSQL ของ Marketplace ได้จริง แยกครั้งละฐานข้อมูล: เริ่มที่ Preview เพื่อทดสอบก่อน แล้วจึง Production โดยใช้ URL/token ตรงกับ environment ของ Vercel แต่ละชุด การเชื่อมฐานข้อมูล Production กับโปรเจกต์แล้ว **ไม่ได้หมายความว่า** `manage.py init` หรือ `bootstrap-admin` ได้รันแล้ว หากฐานข้อมูลมีข้อมูลจากรุ่นก่อน ให้สำรองและทดสอบกู้คืนก่อนรัน `manage.py init` เพื่อเพิ่ม schema และรหัสประจำตัวที่ขาดอยู่ คำสั่งนี้ต้องรันหลังอัปเดตโค้ดทุกครั้งที่มี migration ใหม่ สำหรับ Production ผู้ดูแลเริ่มต้นใช้ชื่อผู้ใช้ `physicsplus` และรหัสที่เจ้าของร้านให้ไว้ก่อนหน้านี้ ให้กรอกใน prompt ที่ไม่แสดงตัวอักษร ไม่เขียนลงเอกสารหรือ environment variable ระบบเก็บเฉพาะ scrypt hash ของรหัสนี้และไม่ได้บังคับเปลี่ยนรหัสเมื่อเข้าครั้งแรกตามที่เจ้าของร้านกำหนด สำหรับ Preview ให้ใช้รหัสทดสอบที่ต่างจาก Production คำสั่ง bootstrap สร้างผู้ดูแลเริ่มต้นได้ครั้งเดียวเมื่อยังไม่มีผู้ดูแล

วิธีส่ง URL และ token ให้คำสั่งเฉพาะครั้งโดยไม่บันทึก token ลงไฟล์หรือประวัติ shell:

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt

python3 - <<'PY'
import getpass
import os
import subprocess

with open("/dev/tty", "r") as tty:
    print("Turso database URL: ", end="", flush=True)
    url = tty.readline().strip()
token = getpass.getpass("Turso auth token: ")
env = os.environ.copy()
env["TURSO_DATABASE_URL"] = url
env["TURSO_AUTH_TOKEN"] = token
with open("/dev/tty", "r") as tty:
    subprocess.run(["python3", "manage.py", "init"], env=env, stdin=tty, check=True)
    subprocess.run(
        ["python3", "manage.py", "bootstrap-admin", "--username", "physicsplus"],
        env=env,
        stdin=tty,
        check=True,
    )
    subprocess.run(["python3", "manage.py", "check"], env=env, stdin=tty, check=True)
PY
```

สำหรับฐานข้อมูล **ใหม่** รันชุดคำสั่งนี้สองครั้ง โดยระบุ URL/token และรหัสผู้ดูแล **คนละชุด** สำหรับ Preview และ Production คำสั่ง `bootstrap-admin` จะถามรหัสผู้ดูแลสองครั้งแบบซ่อนตัวอักษร ไม่ต้องนำรหัสนั้นไปตั้งเป็น environment variable ใน Vercel สำหรับฐานข้อมูลเดิมที่มีผู้ดูแลแล้ว ให้รัน `manage.py init` และ `manage.py check` กับ URL/token ชุดเดิมโดย **ข้าม** `bootstrap-admin` จากนั้นใช้ endpoint ผู้ดูแล `/api/admin/account` เปลี่ยนชื่อผู้ใช้และรหัสผ่านแบบ atomic โดยระบุรหัสเดิมผ่าน HTTPS; ระบบจะยกเลิกเซสชันเดิมทั้งหมด `manage.py check` ต้องรายงาน `admin_count=1` และ `confirmed_default_rate_count=8` ในแต่ละฐานข้อมูล ถ้า migration, bootstrap หรือ check ล้มเหลว **อย่า deploy ต่อ**; ตรวจว่าชี้ฐานข้อมูลและ token ถูกชุด แล้วแก้ข้อผิดพลาดก่อนรันซ้ำ

หลัง `manage.py init` ระบบจะมีทะเบียนครูตุ้ม ครูโรจน์ และครูโจ้พร้อมรหัสครูโดยอัตโนมัติ แต่ยังไม่มีอีเมลและเข้าใช้งานไม่ได้ ผู้ดูแลเพิ่มครูใหม่ได้จากปุ่ม “เพิ่มครู” แล้วเปิดบัญชีครูด้วยอีเมลจริงและรหัสชั่วคราวภายหลัง ครูในทะเบียนที่ยังไม่เปิดบัญชีเลือกเป็นผู้สอนในคอร์สและห้องเรียนได้ แต่ครูจะลงเวลาผ่านบัญชีของตนไม่ได้จนกว่าจะเปิดบัญชี ผู้ดูแลกำหนดราคาคอร์สเองจาก 8 รายการวิชาที่ร้านเปิดสอน และจัดห้อง ครู เวลา รายชื่อนักเรียนเองทั้งหมด การสร้างฐานข้อมูลไม่สุ่มครูหรือจัดตารางเรียน หากอัปเกรดฐานข้อมูลเดิม migration จะเปลี่ยนรหัสที่แสดงจาก `PH-` เป็น `PP-`, ปิดคอร์สเฉพาะรายวิชาที่ร้านไม่เปิดสอน และเก็บยอดคอร์ส ใบแจ้งยอด และประวัติเดิมไว้; คาบเรียนเก่าที่ไม่เคยระบุห้องจะมีชื่อห้องชั่วคราวว่า “ยังไม่ระบุ” และใช้ครูที่อยู่บนคอร์สเดิม ผู้ดูแลต้องตรวจคาบเหล่านี้ก่อนนำตารางหรือค่าจ้างย้อนหลังไปใช้อ้างอิง

## 4. ทดสอบและปล่อยเวอร์ชัน

รันชุดทดสอบ offline ก่อน ชุดนี้ใช้ SQLite จำลอง transport จึงยังไม่พิสูจน์การเชื่อม Turso จริง แล้วสร้าง Preview deployment:

```bash
python3 -m unittest discover -v
vercel deploy
```

เปิด URL ของ **Preview** ที่ CLI ส่งกลับผ่าน HTTPS แล้วทดสอบบัญชีจำลองกับ Preview DB:

1. `/` แสดงหน้า login และไม่มีช่องเลือกบทบาท; ผู้ที่ยังไม่ล็อกอินเข้า dashboard ไม่ได้
2. `/api/me` ตอบสถานะที่สอดคล้องกับการล็อกอิน โดยไม่มีรหัสผ่านหรือ token ฐานข้อมูลใน response
3. ตรวจรายการวิชา 8 รายการ: ม.ต้น วิทยาศาสตร์/คณิตศาสตร์/ภาษาอังกฤษ และ ม.ปลาย ฟิสิกส์/เคมี/ชีวะ/คณิตศาสตร์/ภาษาอังกฤษ ผู้ดูแลต้องกรอกราคาเมื่อสร้างคอร์สและแก้ราคาได้ภายหลังโดยไม่เปลี่ยนยอดใบแจ้งที่ออกแล้ว รหัสวิชาต้องตรงกับระดับและวิชา ส่วนรหัสคอร์สแต่ละชุดกับรหัสประจำตัวนักเรียน/ครูต้องไม่ซ้ำกัน ตรวจทะเบียนครู 3 คน และการเพิ่มครูแบบยังไม่มีอีเมล
4. นักเรียนสมัครโดยกรอกระดับชั้น โรงเรียน และข้อมูลผู้ปกครอง → สมัครเรียน → เห็นสถานะรอผู้ดูแลแจ้งยอด → ผู้ดูแลสร้างใบแจ้งยอดพร้อมจำนวนเงิน/วันครบกำหนด → นักเรียนเห็นยอดที่ผู้ดูแลระบุและแจ้งเลขอ้างอิงชำระเท่านั้น ตรวจว่านักเรียนกำหนดหรือแก้ยอดเองไม่ได้ ทดสอบผู้ดูแลยกเลิกใบแจ้งยอดที่ยังไม่รับเงินและเปิดใบเดิมกลับได้ โดยไม่ทำให้เกิดใบซ้ำ
5. ผู้ดูแลสร้างคาบเรียนและเลือกห้อง ช่วงเวลา ครู รวมทั้งนักเรียนที่ลงคอร์สนั้นเอง ตรวจว่าคาบไม่มีการสุ่มครูหรือเพิ่มรายชื่อจากใบสมัครโดยอัตโนมัติ ตรวจห้อง/ครูที่เวลาซ้อน คาบที่ยกเลิก การแก้รายชื่อ และตารางเรียน/สอนที่แสดงเฉพาะบัญชีที่เกี่ยวข้อง ครูลงเวลา → ผู้ดูแลอนุมัติ → ตรวจคำนวณค่าจ้างและสิทธิ์ไม่ให้ครู/นักเรียนคนอื่นอ่านข้อมูลผู้ปกครอง
6. ผู้ดูแลเปิดแผง “ส่งออกข้อมูล” แล้วดาวน์โหลดรายงาน CSV เพื่อนำเข้า Google Sheet ด้วยมือ; ชุดนักเรียนมีข้อมูลผู้ปกครอง จึงต้องจำกัดสิทธิ์ไฟล์และชีตเฉพาะผู้ดูแล API รายงาน `/api/admin/reports/{students|teachers|courses|classes|class_rosters|enrollments|invoices|payments|claims|teaching|payroll|rates}` ให้ข้อมูลแบบ JSON ทีละหน้าแก่ผู้ดูแลเท่านั้น Sheet ค่าจ้างจะคำนวณทันทีเมื่อกรอกหรือแก้รายการใน Sheet เอง แต่ข้อมูลที่บันทึกในเว็บ **ยังไม่ซิงก์เข้าชีตอัตโนมัติ**
7. เมื่อตั้งค่า Gmail App Password หรือ Resend แล้ว ทดสอบอีเมลกับบัญชีทดสอบจริงโดยกระตุ้นการสมัครเรียน/แจ้งยอด/เปลี่ยนห้องเรียน/อนุมัติรายการ ตรวจว่าไปถึงผู้รับที่ถูกต้องและไม่มีรายละเอียดส่วนบุคคลในข้อความ ตรวจรายการใน outbox ที่ส่งไม่สำเร็จและการทำงานของ Cron แบบไม่บันทึก App Password หรือ API key ลง log
8. ตรวจ cookie มี `Secure`, `HttpOnly`, `SameSite` บน HTTPS; เปลี่ยนรหัสบัญชีทดสอบแล้วเซสชันเก่าหมดอายุ; log ไม่มี token, รหัสผ่าน หรือข้อมูลผู้ปกครอง

หาก Deployment Protection ของ Vercel เปิดอยู่ ให้ใช้การเข้าถึงที่ Vercel อนุญาตตามปกติในการทดสอบ อย่าปิดการป้องกันเพื่อให้ smoke test ผ่าน เมื่อ Preview ผ่านแล้วจึงสร้าง Production deployment ที่ยังไม่ผูกโดเมน:

```bash
vercel deploy --prod --skip-domain
```

ที่ URL ชั่วคราวของ Production ให้ตรวจหน้า login, การปฏิเสธผู้เยี่ยมชมที่เข้า dashboard, การเข้าระบบผู้ดูแลด้วยรหัสที่กรอกในขั้น bootstrap และเรจทั่วไป 8 แถวที่มีผลตั้งแต่ 19 ต.ค. 2026: ม.ต้น 200/250/300/350 และ ม.ปลาย 250/300/350/400 บาท/ชม. ตามช่วง 1–3/4–6/7–9/10–13 คน อย่าใส่ข้อมูลเด็กทดสอบลง Production DB เมื่อผลตรวจพร้อมแล้วจึงผูก Production deployment ที่ทดสอบกับโดเมน:

```bash
vercel promote <deployment-url>
```

ตรวจที่โดเมนจริงอีกครั้งหลัง promote โดยไม่ใส่ข้อมูลเด็กทดสอบลง Production และปิด/ลบข้อมูลทดสอบจาก Preview ตามนโยบายของร้าน `PH_PUBLIC_ORIGIN` ต้องตรงกับ HTTPS origin ของโดเมนจริง หากมีการเปลี่ยนค่า environment variables ต้องสร้าง deployment ใหม่ เพราะ deployment เดิมไม่ได้รับค่าใหม่ย้อนหลัง

## 5. เมื่อมีปัญหาและการกู้คืน

```bash
vercel ls
vercel inspect <deployment-url>
vercel logs <deployment-url>
vercel rollback
```

`vercel rollback` ย้อน **โค้ด/การผูกโดเมน** ไป deployment ก่อนหน้า ไม่ย้อนฐานข้อมูล ก่อน migration ทุกครั้งต้องมี backup/branch ที่ตรวจว่ากู้คืนได้ หาก schema ใหม่ไม่เข้ากับโค้ดเก่า ให้ทำ migration แบบเข้ากันได้หรือแก้ไปข้างหน้า แทนการ rollback โค้ดอย่างเดียว เปลี่ยน Turso token ทันทีหากสงสัยว่ารั่ว และอัปเดต Secret ใน Vercel ก่อน redeploy

ปัจจุบันผู้ดูแลส่งออกรายงาน CSV เพื่อ **นำเข้า Google Sheet ด้วยมือ** ได้ แต่ยังไม่มีการซิงก์ Sheet อัตโนมัติ อีเมลแจ้งเตือนจะเริ่มทำงานต่อเมื่อกำหนด Gmail App Password หรือผู้ให้บริการส่งอื่นครบ และการที่ผู้ให้บริการรับอีเมลแล้วไม่ได้รับประกันว่าจะเข้ากล่องรับ การยืนยันอีเมล, MFA, ระบบส่งรหัสชั่วคราวที่ปลอดภัย และนโยบายเก็บ/ลบข้อมูลเด็กยังต้องดำเนินการก่อนเปิดรับข้อมูลจริง ไม่ควรถือว่าเสร็จเพียงเพราะ Vercel deployment แสดงสถานะ Ready

อ้างอิง: [Flask on Vercel](https://vercel.com/docs/frameworks/backend/flask), [Vercel Marketplace Storage](https://vercel.com/docs/marketplace-storage), [Turso Cloud บน Vercel Marketplace](https://vercel.com/marketplace/tursocloud), [Vercel SMTP](https://vercel.com/kb/guide/serverless-functions-and-smtp), [Google App Password](https://support.google.com/accounts/answer/185833), [Vercel deployment และ promote](https://vercel.com/docs/cli/deploying-from-cli), [Vercel rollback](https://vercel.com/docs/cli/rollback), [Turso Python remote driver](https://github.com/tursodatabase/turso-docs/blob/main/sdk/python/quickstart.mdx)
