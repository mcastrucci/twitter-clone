This is a twitter clone (with some features) using redis and express

i prefered to use a separated front end instead of express templates.
run index.js, program starts on /

DB Structure

Redis
value SESS:<uniqueSessionID>
Set following:<username> -> store users that the current user is following
set followers:<username> -> store the users that are following the current user
value postid -> an incr of postIds
hash post:<postid> -> userid, message and timestamp
hash user:<userid> -> password hash and username
hash users -> k/v of userid and username


![image](https://user-images.githubusercontent.com/33734490/87970069-9b263180-ca99-11ea-9a53-877315120134.png)





![image](https://user-images.githubusercontent.com/33734490/87969305-40d8a100-ca98-11ea-9cf2-00af4c31c3e6.png)
