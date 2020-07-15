const express = require("express");
const app = express();
const redis = require('redis')
const client = redis.createClient()
const bcrypt = require('bcrypt');
const saltRounds = 10;

app.use(express.urlencoded({ extended: true }))
app.use(express.static("public"));

app.get("/", (req, res) => {
    res.sendFile("index.html");
})

app.post("/signin", (req, res)=>{
    //well, this should not happen
    let { email, password } = req.body;
    if(!email || !password)
     res.send("error!");

     //if everyting is ok, we will proceed to check if the user exist in our redit DB
    client.hget("users", email, (err, userID)=>{
        if (err){
            console.log("an error ocurred while sining in");
            res.send("something failed, we are working on it!");
            return;
        }
        if (userID){ //in this case user does exist, we will log in
            client.hget(`user:${userID}`, 'hash', async (err, hash) =>{
                let result = await bcrypt.compare(password, hash);
                console.log(result);
                if(result){
                    res.send("loged in!");
                }else
                    res.send("wrong password!");
                return;
                    
            })
        }else { //user does not exist, we will register
            client.incr('userid', async (err, userIdFromDb) => { // in our DB structure, we increment the ID, this is a new user
                if (err){
                    console.log("something went wrong during the registration processs");
                    res.send("something failed, we are working on it!");
                    return;
                }
                client.hset('users', email, userIdFromDb) // we create a new username and we match it with the new ID
                //now we will store the hash of the password
                const hash = await bcrypt.hash(password, saltRounds);
                //finally, we will create an entry userID - user email - hash
                client.hset(`user:${userIdFromDb}`, 'hash', hash, 'username', email);
                res.send("registration complete!");
                return;
            });
            
        }

    });
})

app.listen(3000, () => console.log("server running"));