// SPDX-License-Identifier: MIT
// Original RetroRoom cartridge; no third-party game data.
export function makePixelDemo() {
  return new TextEncoder().encode(`pico-8 cartridge // http://www.pico-8.com
version 42
__lua__
-- pixel duo / original retroroom demo
function _init()
 x={32,88} y={70,70} score=0
 cartdata("retroroom_pixel_duo")
 score=dget(0)
end
function _update60()
 for p=0,1 do
  local i=p+1
  if btn(0,p) then x[i]-=1 end
  if btn(1,p) then x[i]+=1 end
  if btn(2,p) then y[i]-=1 end
  if btn(3,p) then y[i]+=1 end
  x[i]=mid(4,x[i],116) y[i]=mid(40,y[i],106)
  if btnp(4,p) or btnp(5,p) then
   score+=1 dset(0,score) sfx(0)
  end
 end
end
function _draw()
 cls(1)
 print("retro room",44,10,7)
 print("pixel duo",46,22,10)
 rect(2,38,125,116,13)
 for i=1,2 do
  rectfill(x[i],y[i],x[i]+7,y[i]+7,i==1 and 8 or 11)
  print(i.."p",x[i],y[i]-9,7)
 end
 print("o/x: "..score,8,122,7)
end
__sfx__
00010000${'1c35020350'.repeat(4)}${'00000'.repeat(24)}
`);
}
