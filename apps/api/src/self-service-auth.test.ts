import test from 'node:test';
import assert from 'node:assert/strict';
import {registerInput,resetInput,resetTokenHash} from './self-service-auth.js';
test('self-service inputs normalize email, preserve passwords and reject supplied roles',()=>{
 const good={fullName:' Name ',email:' Test@Example.com ',password:' long password '};const parsed=registerInput.parse(good);assert.equal(parsed.email,'test@example.com');assert.equal(parsed.password,good.password);assert.equal(parsed.fullName,'Name');
 assert.equal(registerInput.safeParse({...good,role:'admin'}).success,false);assert.equal(registerInput.safeParse({...good,password:'short'}).success,false);assert.equal(resetInput.safeParse({token:'x',newPassword:good.password}).success,false);assert.equal(resetTokenHash('a'.repeat(64)).length,64);
});
