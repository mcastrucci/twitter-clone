const express = require("express");
const app = express();

const { promisify } = require('util')
const bcrypt = require('bcrypt');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

const redis = require('redis');
const client = redis.createClient();


const ahget = promisify(client.hget).bind(client)
const asmembers = promisify(client.smembers).bind(client)
const ahkeys = promisify(client.hkeys).bind(client)
const aincr = promisify(client.incr).bind(client)
const alrange = promisify(client.lrange).bind(client)


const saltRounds = 10;

const __exposedDir = __dirname + "/public/";


/*
middlewares section
*/
app.use(express.urlencoded({ extended: true }))
app.use(express.static(__dirname + "/public"));
app.use(express.json());

app.use(
    session({
      store: new RedisStore({ client: client }),
      resave: true,
      saveUninitialized: true,
      cookie: {
        maxAge: 36000000, //10 hours, in milliseconds
        httpOnly: false,
        secure: false,
      },
      secret: 'eN01gOXUV2HN21OnBhWF',
    })
)

const checkSignedOn = (req, res, next) => {
    //if route is /signin, we allow it to continue
    if(req.url === "/signin"){
        next();
        return;
    }
    if(!req.session.userid){
        res.sendFile(__exposedDir + "signin/signin.html");
        return;
    }
    next();
}

app.use(checkSignedOn);

//****/

app.get("/", (req, res) => {
        res.sendfile(__exposedDir + "dashboard/home.html")
})

app.get("/getFollowersSugestion", async (req, res) => {
    console.log("/getFollowersSugestion --- getting people to follow ---");
    try{
        const allUsers = await getAllUsers();  // we get all users from the DB
    
        //we will need the userName from the id of the session
        const userName = await getUserName(req.session.userid);
    
        //now that we have the user name, lets get the followers
        const followSugestion = await getUsersToFollowSuggestion(userName, allUsers);
    
        //we return that list
        await res.send(followSugestion);
    }catch (ex){
        res.status(500).send("failed to get sugested people to follow");
    }
})


app.get("/get-tweets", (req, res) => {
    if(!req.session.userid){
        res.redirect("/");
        return;
    }

    let tweets = [];
    
    client.hkeys("users", (err, users)=> {
        if (err){
            res.status(500).send("failed to get people to follow");
            return;
        }

        console.log("getting tweets");
        //in order to get tweets, first lets get the name of the user
        getUserName(req.session.userid).then((userName)=>{
            console.log("tweets -- userName", userName);
            //now that we have the user name, lets get the followers
            console.log(userName, users);
            getFollowedUsers(userName, users).then(followingUsers=>{
                console.log("following users--" , followingUsers)
                //now that we have the people that this user follow, lets get the tweets of each
                for(user of followingUsers.users){
                    //to make this, we will need the id of the user
                    console.log("iterating over following users");
                    client.hget("users", user, (err, userID)=> { //first we get the user ID from DB if it does not exist, we redirect to root
                        console.log("got the id of the followed user", userID);
                        if (err){
                            res.status(500).send("something went wrong, please try again in some minutes");
                            return;
                        }
                        //now we get all posts of the user
                        client.hgetall(`post:${userID}`, (err, listOfPosts) => {
                            console.log("current following user list of post", listOfPosts);
                            //we iterate over the posts
                            if (listOfPosts){
                                for (post of listOfPosts){
                                    let tempPost = {
                                        user: user,
                                        tweet: post.message,
                                        time: post.timestamp
                                    }
                                    tweets.push(tempPost);
                                }
                            }
                        })
                    });
                }

                res.send(JSON.stringify({feed: {
                    tempPost
                }}));

            }).catch(err =>{
                res.status(500).send("failed while getting user name");
            })
        }).catch((err)=>{
            console.log(err);
            res.status(500).send("failed while getting user name");
            return;
        });

    });  
})

app.post("/post", async (req, res) => {
    if (req.body.user_tweet){
        const user_tweet = req.body.user_tweet;
        let userId = req.session.userid;
        let userName = await getUserName(userId);
        try {
            //we need to get the next post id from the DB
            const nextPostId = await aincr("postid");

            //now that we have the next post id, we create a hash for this post in the DB --- postID as key -> userId - message and timestamp
            await client.hset(`post:${nextPostId}`, 'userid', req.session.userid, 'message', user_tweet, 'timestamp', Date.now(), (err) =>{
                if (err)
                    throw err; //if something fails
            });
            console.log(`user ${userId} - ${userName} posted:  ${user_tweet}`);
            // now that the post is done we redirect user to the dashboard /TODO - show a message to the user
            await res.redirect("/");
        }catch (ex) {
            console.log(ex);
            res.status(500).send("we are sorry, somthing happend with your post, please try again in a few minutes")
        }

    } else {
        res.status(400).send("no text provided");
    }
})

app.post("/follow", async (req, res) =>{
    let { userToFollow } = req.body;
    let userId = req.session.userid;
    

    if (userToFollow){  //if request does not have this, something is wrong
        
        let currentUserName = await getUserName(userId);
        let userToFollowId = "";
        console.log(`user ${currentUserName} requested to follow the user ${userToFollow}`);

        //first we should check if the user exists on the DB
        try{
            userToFollowId = await ahget ("users", userToFollow);
            if(!userToFollowId)
                throw ("no user"); //this should not happen
        }catch (noUser) { //this could indicate that the user does not exist on the db or there is any error
            res.status(500).send("error while getting user to follow, please, try again later");
            return;
        }
        //if we are here, everything is ok.
        await console.log(`user ${userToFollow} exists, its id is ${userToFollowId}`);

        //we will add (or create if it does not exist) a SET with followers and following
        try{
            await followUser(currentUserName, userToFollow);
            await console.log(`user ${currentUserName} is now following the user ${userToFollow}`);
            
            await res.status(200).send(JSON.stringify(
                { response: `you are now following ${userToFollow}`}
            ));
        } catch(Ex) {
            res.status(500).send("failing while following selected user, try again later");
        }          
    } else {
        res.status(400).send("bad request, please, try again");
        return;
    }

    const followUser = (currentUserName, userToFollow) => new Promise((resolve, reject) =>{
        client.sadd(`following:${currentUserName}`, userToFollow, err => {
            reject(err);
        });
        client.sadd(`followers:${userToFollow}`, currentUserName, err => {
            reject(err);
        });
        resolve();
    })
})

app.post("/signin", async (req, res)=>{
    //well, this should not happen since there is checks on the front end
    let { email, password } = req.body;
    if(!email || !password){
        res.send("error!");
        return;
    }

     try{   
        //if everyting is ok, we will proceed to check if the user exist in our redit DB
        const userID = await ahget("users", email);
        console.log(`User ${email} requested to signin -- it exists on DB ${userID}`);
        if (userID){ //in this case user does exist, we will log in
            await handleLogin(userID, password);
        }else { //user does not exist, we will register
            await handleSignup(email, password)
        }
    } catch (Ex) {
        console.log("an error ocurred while sining in", Ex);
        res.send("something failed, we are working on it!");
        return;
     }

    async function handleLogin (idFromDB, password) {
        // we need to get the user hash from DB
        try {
            const userHash = await ahget(`user:${idFromDB}`, 'hash');
            //now that we have the hash, we compare the password with the hash using bcrypt
            let result = await bcrypt.compare(password, userHash);
            console.log("password is ", result ? "correct" : "wrong");
            if(result){ //everything ine, lets redirect him to dashboard
                saveSessionAndRedirectToDashboard(idFromDB);
                return;
            }else{
                res.send("wrong password!");
                return;
            }
        } catch (Ex) {
            console.log(Ex);
            res.status(500).send("failed while signing in");
        }                
    }

    async function handleSignup(email, password) {
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
            saveSessionAndRedirectToDashboard(userIdFromDb);
            return;
        });    
    }

    async function saveSessionAndRedirectToDashboard(userID) {
        req.session.userid = userID;
        req.session.save();
        res.status(200).redirect("/");
    };
})

app.listen(3000, () => console.log("server running"));

//Database Methods

const getAllUsers = async () => await ahkeys("users");

const getUserName = async (userID) => ahget(`user:${userID}`, "username");

const getUsersToFollowSuggestion = async (userName, users)  => {
    //first we get all people that the current user is following
    const currentUserFollowedPeople = await asmembers (`following:${userName.trim()}`); 
    console.log("---current user is following: ", currentUserFollowedPeople);

    let returningList = [];
    //now lets iterate over the users and remove the ones that should not be there

    for(item of users){
        let push = true;
        if(currentUserFollowedPeople && currentUserFollowedPeople.includes(item))
            push = false;
        if (item === userName)
            push = false;

        if (push)
            returningList.push(item);
    }
    return {users: returningList};
}

/*@Returns the list of followed people for currentUser
*/
const getFollowedUsersForCurrentUser = async (userName, users) => {
    //we get the people that current user is following
    const currentUserFollowedPeople = await asmembers(`following:${userName.trim()}`);
    let returningList = [];

    //now lets iterate over the users and remove the ones that should not be there
    for(item of users){
        let push = true;
        if(!following.includes(item))
            push = false;
        if (item === userName)
            push = false;

        if (push)
            returningList.push(item);
    }
    return {users: returningList}
}