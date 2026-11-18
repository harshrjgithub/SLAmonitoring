import { Router } from 'express';
import type { DB } from '../db.js';
import { hasPermission, requireAuth, type AuthedRequest } from '../auth.js';

function isManager(db:DB,req:AuthedRequest){return req.user!.role==='admin'||hasPermission(db,req.user!.sub,req.user!.role,'manage_employees');}
function managerIds(db:DB){return (db.prepare(`SELECT DISTINCT u.id FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id
  LEFT JOIN role_permissions rp ON rp.role_id=ur.role_id LEFT JOIN permissions p ON p.id=rp.permission_id
  WHERE u.account_status='active' AND (u.role='admin' OR p.permission_key='manage_employees')`).all() as Array<{id:number}>).map(x=>x.id);}

export function notificationRoutes(db:DB):Router{
  const router=Router();router.use(requireAuth);
  router.get('/',(req:AuthedRequest,res)=>{
    if(isManager(db,req)){
      const now=new Date(); const upcoming=new Date(now.getTime()+60*60*1000).toISOString();
      const overdue=db.prepare(`SELECT id,title,sla_due_at FROM tickets WHERE status IN ('open','assigned','in_progress','on_hold','escalated','reopened') AND sla_due_at IS NOT NULL`).all() as Array<{id:number;title:string;sla_due_at:string}>;
      const insert=db.prepare('INSERT INTO notifications (user_id,ticket_id,type,message) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id=? AND ticket_id=? AND type=?)');
      for(const ticket of overdue){const type=ticket.sla_due_at<now.toISOString()?'sla_overdue':ticket.sla_due_at<upcoming?'sla_approaching':null;if(!type)continue;for(const managerId of managerIds(db))insert.run(managerId,ticket.id,type,type==='sla_overdue'?`Ticket #${ticket.id} is overdue`:`Ticket #${ticket.id} is approaching its SLA deadline`,managerId,ticket.id,type);}
    }
    const notifications=db.prepare(`SELECT n.id,n.ticket_id,n.type,n.message,n.is_read,n.created_at,t.title AS ticket_title
      FROM notifications n LEFT JOIN tickets t ON t.id=n.ticket_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100`).all(req.user!.sub);
    return res.json({notifications});
  });
  router.patch('/:id/read',(req:AuthedRequest,res)=>{
    const result=db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id,req.user!.sub);
    return Number(result.changes)?res.json({read:true}):res.status(404).json({error:'Notification not found'});
  });
  router.patch('/read-all',(req:AuthedRequest,res)=>{
    const result=db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user!.sub);
    return res.json({updated:Number(result.changes)});
  });
  return router;
}
