import {db,pool} from './db.js';import {categories} from './schema.js';
const names=['Ерөнхий техникийн мэдлэг','Хөдөлгүүр ба дамжуулга','Нислэгийн гүйцэтгэл','Нислэгийн удирдлага ба авионик','Цахилгаан систем','Гидравлик систем','Аврах ажиллагаа ба өргүүр','Нислэгийн аюулгүй байдал','Техникийн үйлчилгээ ба MEL','Fuselage','Main Airframe','Doors','Reference Planes','Access Panels','Cabin Structure','Windows','Levelling','Drain Lines','Jacking','Cowling','Weighing','Hoisting','Towing','Parking'];
try{for(let i=0;i<names.length;i++)await db.insert(categories).values({name:names[i],sortOrder:i}).onConflictDoNothing();console.log('Ангиллууд бэлэн боллоо. Техникийн жишээ асуулт үүсгээгүй.')}finally{await pool.end()}

